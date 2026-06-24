#!/usr/bin/env bash
# eval-golden.sh — 一鍵生成 golden-set 評測草稿
# 用法: pnpm eval:golden [--output <dir>]
# 需要環境變數 LLM_ENDPOINT、LLM_API_KEY、LLM_MODEL（可從 packages/backend/.env 讀取）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 載入 .env（若存在）
ENV_FILE="$REPO_ROOT/packages/backend/.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs)
fi

# 解析 --output 參數
OUTPUT_DIR="$REPO_ROOT/docs/eval/runs"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done

mkdir -p "$OUTPUT_DIR"

RUN_ID="$(date +%Y%m%d-%H%M%S)"
REPORT_FILE="$OUTPUT_DIR/golden-$RUN_ID.md"

# 必要環境變數確認
if [[ -z "${LLM_ENDPOINT:-}" ]] || [[ -z "${LLM_API_KEY:-}" ]]; then
  echo "錯誤: LLM_ENDPOINT 或 LLM_API_KEY 未設定。"
  echo "請先複製 packages/backend/.env.example → .env 並填入真實值。"
  exit 1
fi

MODEL="${LLM_MODEL:-gpt-4o-mini}"

# 後端 URL（eval 直接呼叫 LLM，不經後端）
BACKEND_URL="${BACKEND_URL:-http://localhost:3002}"

echo "=== Golden-Set Eval Run: $RUN_ID ==="
echo "Model: $MODEL"
echo "Output: $REPORT_FILE"
echo ""

# Golden topics 定義
declare -a TOPICS=(
  "某明星疑似出轨爆料"
  "知名网红解约撕逼事件"
  "当红艺人公开恋情官宣"
  "某歌手深夜道歉风波"
  "八卦盘点：年度十大塌房事件"
  "某小花否认绯闻传言"
  "经典情侣官宣复婚传闻"
  "热门剧组合作炒作内幕"
  "某演员合约到期不续约"
  "明星慈善晚会现场撕逼"
)

declare -a IDS=(G01 G02 G03 G04 G05 G06 G07 G08 G09 G10)

# 讀取當前 prompt template（從後端 settings endpoint 或使用預設）
PROMPT_SYSTEM="你是「瓜哥」，吃瓜娱乐资讯博主，口吻活泼轻松，以「嗨！瓜哥来了」开场、结尾招呼大家继续关注。只根据事实写，严禁编造，以 JSON 返回：intro、highlights、outro。"

# 寫報告頭
cat > "$REPORT_FILE" << HEADER
# Golden-Set Eval Report

- **Run ID**: $RUN_ID
- **Model**: $MODEL
- **Date**: $(date '+%Y-%m-%d %H:%M:%S')
- **Endpoint**: $LLM_ENDPOINT

請對每條草稿按三維打分（1=差 / 2=可接受 / 3=好）：
- 覆蓋要點 / 口吻 / 雷同度（低=好）

---

HEADER

PASS=0
FAIL=0

for i in "${!TOPICS[@]}"; do
  ID="${IDS[$i]}"
  TOPIC="${TOPICS[$i]}"
  echo -n "[$ID] $TOPIC ... "

  # 呼叫 LLM API
  RESPONSE=$(curl -sf "$LLM_ENDPOINT/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $LLM_API_KEY" \
    --max-time 60 \
    -d "$(jq -n \
      --arg model "$MODEL" \
      --arg system "$PROMPT_SYSTEM" \
      --arg topic "$TOPIC" \
      '{model: $model, max_tokens: 800, messages: [
        {role: "system", content: $system},
        {role: "user", content: ("選題：" + $topic)}
      ]}'
    )" 2>/dev/null || true)

  if [[ -z "$RESPONSE" ]]; then
    echo "FAIL (no response)"
    FAIL=$((FAIL + 1))
    {
      echo "## $ID — $TOPIC"
      echo ""
      echo "> **錯誤**: API 無回應（逾時或網路問題）"
      echo ""
      echo "---"
      echo ""
    } >> "$REPORT_FILE"
    continue
  fi

  CONTENT=$(echo "$RESPONSE" | jq -r '.choices[0].message.content // ""' 2>/dev/null || echo "")

  if [[ -z "$CONTENT" ]]; then
    echo "FAIL (empty content)"
    FAIL=$((FAIL + 1))
    {
      echo "## $ID — $TOPIC"
      echo ""
      echo "> **錯誤**: 回應為空或格式異常"
      echo ""
      echo "\`\`\`json"
      echo "$RESPONSE" | head -5
      echo "\`\`\`"
      echo ""
      echo "---"
      echo ""
    } >> "$REPORT_FILE"
    continue
  fi

  echo "OK"
  PASS=$((PASS + 1))

  {
    echo "## $ID — $TOPIC"
    echo ""
    echo "**打分（請填入）**: 覆蓋要點: __ / 口吻: __ / 雷同度: __"
    echo ""
    echo "### 生成草稿"
    echo ""
    echo "\`\`\`json"
    # 嘗試格式化 JSON，失敗則原文輸出
    echo "$CONTENT" | jq '.' 2>/dev/null || echo "$CONTENT"
    echo "\`\`\`"
    echo ""
    echo "**備注**:"
    echo ""
    echo "---"
    echo ""
  } >> "$REPORT_FILE"
done

# 報告尾
{
  echo "## 版本對比記錄（本次）"
  echo ""
  echo "| 日期 | Model | Pass | Fail | 總分 | 備注 |"
  echo "|------|-------|------|------|------|------|"
  echo "| $(date '+%Y-%m-%d') | $MODEL | $PASS | $FAIL | _（待填）_ | |"
} >> "$REPORT_FILE"

echo ""
echo "=== 完成 ==="
echo "通過: $PASS / 失敗: $FAIL"
echo "報告: $REPORT_FILE"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
