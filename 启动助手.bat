@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  51publisher 发帖填充助手 — 启动向导
echo  ════════════════════════════════════
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  ❌ 未找到 Node.js，请先安装：
  echo     https://nodejs.org
  echo.
  pause
  exit /b 1
)

node scripts\setup.mjs
echo.
pause
