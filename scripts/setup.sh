#!/usr/bin/env bash
# 51publisher 0-to-1 setup script
# Usage: bash scripts/setup.sh
# Handles: Node check, pnpm install, .env init, backend build & start.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/packages/backend/.env"
ENV_EXAMPLE="$REPO_ROOT/packages/backend/.env.example"
DIST_JS="$REPO_ROOT/packages/backend/dist/index.js"
HEALTHZ="http://localhost:3001/api/v1/healthz"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { echo -e "${CYAN}[setup]${NC} $*"; }
ok()    { echo -e "${GREEN}[setup]${NC} $*"; }
warn()  { echo -e "${YELLOW}[setup]${NC} $*"; }
error() { echo -e "${RED}[setup] ERROR:${NC} $*" >&2; }

# ── 1. Node.js 版本检查 ────────────────────────────────────────────────────────
info "检查 Node.js..."
if ! command -v node &>/dev/null; then
  error "未找到 Node.js。请先安装 Node.js ≥ 20："
  error "  https://nodejs.org  或  brew install node"
  exit 1
fi
NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  error "Node.js 版本过低（当前 $(node -v)，需要 ≥ 20）。"
  error "  brew upgrade node  或  nvm install 20 && nvm use 20"
  exit 1
fi
ok "Node.js $(node -v) ✓"

# ── 2. pnpm 检查 / 自动安装 ───────────────────────────────────────────────────
info "检查 pnpm..."
if ! command -v pnpm &>/dev/null; then
  warn "未找到 pnpm，尝试通过 npm 安装..."
  npm install -g pnpm
  ok "pnpm 安装完成"
fi
ok "pnpm $(pnpm -v) ✓"

# ── 3. 安装依赖 ───────────────────────────────────────────────────────────────
info "安装项目依赖（pnpm install）..."
cd "$REPO_ROOT"
pnpm install
ok "依赖安装完成 ✓"

# ── 4. 配置 .env ──────────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  info "未找到 .env，从模板创建..."
  cp "$ENV_EXAMPLE" "$ENV_FILE"

  echo ""
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}  需要填写几个必填项才能启动后端。${NC}"
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  # LLM_API_KEY
  echo ""
  read -r -p "  LLM API Key（la-sealion 平台的 sk-... key）: " LLM_KEY
  if [[ -n "$LLM_KEY" ]]; then
    sed -i.bak "s|LLM_API_KEY=.*|LLM_API_KEY=$LLM_KEY|" "$ENV_FILE"
  fi

  # LLM_ENDPOINT — 预设值已经正确，直接确认
  echo ""
  read -r -p "  LLM Endpoint [https://la-sealion.inaiai.com/v1]: " LLM_EP
  LLM_EP="${LLM_EP:-https://la-sealion.inaiai.com/v1}"
  sed -i.bak "s|LLM_ENDPOINT=.*|LLM_ENDPOINT=$LLM_EP|" "$ENV_FILE"

  # CORS_ORIGIN — 可稍后填
  echo ""
  echo "  CORS_ORIGIN：Chrome 扩展的 ID（格式 chrome-extension://abcdef...）"
  echo "  （可暂填 placeholder，加载扩展后在 chrome://extensions 找到 ID 再改 .env）"
  read -r -p "  CORS_ORIGIN [chrome-extension://PLACEHOLDER]: " CORS
  CORS="${CORS:-chrome-extension://PLACEHOLDER}"
  sed -i.bak "s|CORS_ORIGIN=.*|CORS_ORIGIN=$CORS|" "$ENV_FILE"

  # 自动生成 JWT_SECRET
  JWT_SECRET_VAL=$(node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))")
  sed -i.bak "s|JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET_VAL|" "$ENV_FILE"
  ok "JWT_SECRET 已自动生成 ✓"

  # JWT_ADMIN_PASSWORD_HASH — 读取密码后以 arg 方式传给 hash-password.mjs
  echo ""
  echo "  设置管理员密码（用于登录后端 API，至少 8 位）。"
  while true; do
    read -r -s -p "  Admin 密码: " ADMIN_PW; echo ""
    read -r -s -p "  确认密码:   " ADMIN_PW2; echo ""
    if [[ "$ADMIN_PW" != "$ADMIN_PW2" ]]; then
      warn "两次密码不一致，请重新输入。"
    elif [[ "${#ADMIN_PW}" -lt 8 ]]; then
      warn "密码至少 8 位，请重新输入。"
    else
      break
    fi
  done
  HASH_LINE=$(node "$REPO_ROOT/packages/backend/scripts/hash-password.mjs" "$ADMIN_PW")
  HASH_VAL="${HASH_LINE#JWT_ADMIN_PASSWORD_HASH=}"
  if [[ -n "$HASH_VAL" ]]; then
    sed -i.bak "s|JWT_ADMIN_PASSWORD_HASH=.*|JWT_ADMIN_PASSWORD_HASH=$HASH_VAL|" "$ENV_FILE"
    ok "JWT_ADMIN_PASSWORD_HASH 已写入 ✓"
  else
    warn "密码 hash 生成失败，请手动运行: node packages/backend/scripts/hash-password.mjs"
    warn "并将输出填入 packages/backend/.env 的 JWT_ADMIN_PASSWORD_HASH="
  fi

  # 清理 .bak 文件
  rm -f "$ENV_FILE.bak"

  ok ".env 初始化完成 → $ENV_FILE"
else
  ok ".env 已存在，跳过初始化 ✓"
fi

# ── 5. 构建后端 ───────────────────────────────────────────────────────────────
needs_build() {
  [[ ! -f "$DIST_JS" ]] && return 0
  [[ -n "$(find "$REPO_ROOT/packages/backend/src" -name "*.ts" -newer "$DIST_JS" 2>/dev/null)" ]]
}

if needs_build; then
  info "构建后端..."
  pnpm --filter publisher-backend build
  ok "后端构建完成 ✓"
else
  ok "后端构建产物是最新的，跳过构建 ✓"
fi

# ── 6. 检查后端是否已在运行 ───────────────────────────────────────────────────
if curl -sf "$HEALTHZ" >/dev/null 2>&1; then
  ok "后端已在运行（$HEALTHZ → ok）✓"
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  ✅ 设置完成！后端已就绪，加载扩展即可使用。${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  exit 0
fi

# ── 7. 启动后端 ───────────────────────────────────────────────────────────────
info "启动后端服务..."
set -a; source "$ENV_FILE"; set +a

# 后台运行，日志写到 /tmp/51publisher-backend.log
LOG_FILE="/tmp/51publisher-backend.log"
nohup node "$DIST_JS" >> "$LOG_FILE" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > /tmp/51publisher-backend.pid
info "后端进程 pid=$BACKEND_PID，日志: $LOG_FILE"

# 等待 healthz 就绪（最多 15 秒）
for i in $(seq 1 15); do
  sleep 1
  if curl -sf "$HEALTHZ" >/dev/null 2>&1; then
    ok "后端已就绪（pid=$BACKEND_PID）✓"
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    error "后端进程意外退出，查看日志："
    error "  cat $LOG_FILE"
    exit 1
  fi
  echo -e "  等待后端启动... ($i/15)"
done

if ! curl -sf "$HEALTHZ" >/dev/null 2>&1; then
  error "后端 15 秒内未响应 $HEALTHZ"
  error "请查看日志：cat $LOG_FILE"
  kill "$BACKEND_PID" 2>/dev/null || true
  exit 1
fi

# ── 8. 完成摘要 ───────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✅ 设置完成！${NC}"
echo ""
echo -e "  后端地址: ${CYAN}http://localhost:3001${NC}"
echo -e "  健康检查: ${CYAN}$HEALTHZ${NC}"
echo -e "  后端日志: ${CYAN}$LOG_FILE${NC}"
echo -e "  停止服务: ${CYAN}kill \$(cat /tmp/51publisher-backend.pid)${NC}"
echo ""
echo "  下一步：在 Chrome 加载扩展"
echo "    chrome://extensions → 开启开发者模式 → 加载已解压"
echo "    → 选 packages/extension/.output/chrome-mv3/"
echo ""
if grep -q "PLACEHOLDER" "$ENV_FILE" 2>/dev/null; then
  warn "提醒：CORS_ORIGIN 仍是 PLACEHOLDER，加载扩展后请更新 .env 并重启后端。"
fi
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
