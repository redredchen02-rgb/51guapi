#!/usr/bin/env bash
# 双击即可运行 —— macOS Terminal 会自动打开此脚本
cd "$(dirname "$0")"

# 检查 Node.js
if ! command -v node &>/dev/null; then
  echo "❌ 未找到 Node.js，请先安装："
  echo "   https://nodejs.org"
  echo ""
  read -r -p "按 Enter 关闭..."
  exit 1
fi

node scripts/setup.mjs
echo ""
read -r -p "按 Enter 关闭..."
