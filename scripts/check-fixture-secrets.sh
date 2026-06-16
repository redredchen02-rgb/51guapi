#!/usr/bin/env bash
# 脱敏闸门:阻止把含机密的 fixture 提交进仓库(进 git 历史几乎不可撤回)。
#
# 设计(评审拈出,安全边界要 fail-closed):
#   - 主规则(allowlist 风格):隐藏鉴权字段一律不许带值 —— 任何 type="hidden" 的 input
#     不得有非空 value。检测**与属性顺序无关**(先抽出每个 <input> 标签,再分别判
#     「是 hidden」与「有非空 value」),避免 `<input value=.. type=hidden>` 绕过。
#   - 次规则(denylist tripwire):再扫一遍常见机密形态(token/cookie/JWT/长 hex)。
#   - 自检:用**运行时生成**的投毒样本验证闸门能检出,否则判定闸门已 no-op 并大声失败。
#     (投毒样本不落仓库,免得假机密触发外部 secret 扫描器。)
#
# 诚实局限:shell 闸门无法完整解析 HTML,挡不住所有未知字段名的机密;它是「合成 fixture +
#   人工脱敏 + 人工复核」之上的一道自动兜底,不是唯一防线。详见 docs/e2e-and-iteration-guide.md。
set -uo pipefail

# FIXTURE_DIR 锚定到脚本位置(绝对路径),与调用方 cwd 无关。
# 旧版用相对路径 "tests/e2e/fixtures",从 repo 根调用(pre-commit hook / CI)时解析到
# 不存在的 <root>/tests/e2e/fixtures → nullglob 扫 0 文件 → 自检通过 → 假绿(闸门 no-op)。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE_DIR="$SCRIPT_DIR/../packages/extension/tests/e2e/fixtures"

# denylist:常见机密形态。命中即视为含机密。JWT 阈值放宽到 8(短 JWT 也拦)。
DENYLIST='Bearer [A-Za-z0-9._-]+|Set-Cookie|JSESSIONID|PHPSESSID|csrf[_-]?token|_token|sessionid|session=|eyJ[A-Za-z0-9_-]{8,}|[A-Fa-f0-9]{32,}'

# 检出一个文件里的机密;命中输出证据、返回 0(有机密),无命中返回 1,出错返回 2。
detect_secrets() {
  local file="$1"
  [ -f "$file" ] || return 2
  local hits=""

  # 主规则:把换行归一为空格,抽出每个 <input ...> 标签,
  # 顺序无关地判定「是 hidden」且「有非空 value」。
  local normalized hidden
  normalized=$(tr '\r\n' '  ' < "$file" 2>/dev/null) || return 2
  hidden=$(printf '%s' "$normalized" | grep -oiE '<input[^>]*>' 2>/dev/null | while IFS= read -r tag; do
    if printf '%s' "$tag" | grep -qiE 'type=["'"'"']?hidden' \
       && printf '%s' "$tag" | grep -qiE 'value=["'"'"'][^"'"'"'>]*[^"'"'"'>[:space:]]'; then
      printf '%s\n' "$tag"
    fi
  done)

  # 次规则:denylist 形态(在原文上扫,保留行号)。
  local deny dg
  deny=$(grep -nEi "$DENYLIST" "$file" 2>/dev/null)
  dg=$?
  if [ $dg -eq 2 ]; then return 2; fi

  hits="${hidden}${deny}"
  if [ -n "$hits" ]; then
    printf '%s\n' "$hits"
    return 0
  fi
  return 1
}

# --- 1. 自检:运行时生成投毒样本,必须被检出 ---
POISON=$(mktemp "${TMPDIR:-/tmp}/pfa-poison.XXXXXX.html") || { echo "✗ 无法创建自检临时文件。" >&2; exit 2; }
trap 'rm -f "$POISON"' EXIT
cat > "$POISON" <<'POISONED'
<form>
  <input value="aB3xYz9KqLmN0pQrStUv1234567890ee" type="hidden" name="_token" />
  <span>Set-Cookie: PHPSESSID=deadbeefdeadbeefdeadbeef</span>
  <span>Bearer eyJhbGciOiJIUzI1NiIsfakefaketoken</span>
</form>
POISONED
if ! detect_secrets "$POISON" >/dev/null; then
  echo "✗ 闸门自检失败:运行时投毒样本未被检出 —— 闸门可能已 no-op(fail-open),拒绝放行。" >&2
  exit 2
fi

# --- 2. 实扫:所有非点前缀 *.html 必须干净 ---
# 目录整体不存在 ⇒ 没有 fixture 可泄密,放行(自检已证闸门有效)。
# 这区别于「目录存在却扫不到 html」(下方),后者多半是路径/cwd 错,仍 fail-closed。
if [ ! -d "$FIXTURE_DIR" ]; then
  echo "✓ fixture 目录不存在($FIXTURE_DIR)—— 无 fixture 可扫,放行。"
  exit 0
fi
shopt -s nullglob
fixture_files=("$FIXTURE_DIR"/*.html)
if [ ${#fixture_files[@]} -eq 0 ]; then
  echo "✗ $FIXTURE_DIR 下无 *.html fixture —— 闸门扫不到任何文件(疑似路径错),拒绝放行。" >&2
  exit 2
fi
status=0
for f in "${fixture_files[@]}"; do
  out=$(detect_secrets "$f")
  rc=$?
  if [ $rc -eq 2 ]; then
    echo "✗ 扫描 $f 时出错。" >&2
    exit 2
  elif [ $rc -eq 0 ]; then
    echo "✗ $f 含疑似机密(token/cookie/JWT/长 hex 或带值的隐藏字段):" >&2
    printf '%s\n' "$out" | sed 's/^/    /' >&2
    status=1
  fi
done

if [ $status -eq 0 ]; then
  echo "✓ fixtures 脱敏闸门通过(自检有效 + 无机密命中)。"
fi
exit $status
