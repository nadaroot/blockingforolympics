@echo off
title LOKED Client (Windowed Preview)
cd /d "%~dp0"
echo Starting LOKED Windowed Preview (no key locks)...
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0client\src\main.js" --windowed
