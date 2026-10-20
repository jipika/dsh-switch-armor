@echo off
chcp 65001 >nul
title Switch Armor 安装向导
echo.
echo ======================================================
echo    Switch Armor — 跨平台安装向导（Windows）
echo ======================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。
  echo 请先安装 DeepSeek Harness 桌面端（自带 node），或安装 Node.js 20+ 后重试。
  echo.
  pause
  exit /b 1
)
node "%~dp0scripts\install.mjs" %*
echo.
echo 按任意键退出...
pause >nul
