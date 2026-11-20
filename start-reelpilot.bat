@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "NODE_BIN=C:\Users\Admin\AppData\Roaming\Antigravity\bin\agy-node.cmd"
if not exist "%NODE_BIN%" (
  set "NODE_BIN=node"
)

echo ========================================================
echo   ReelPilot Studio v1.0 — YouTube Shorts & FB Reels
echo   Dang khoi dong tai http://localhost:4330 ...
echo ========================================================

start "" http://localhost:4330
"%NODE_BIN%" server\index.js
pause
