@echo off
title LOKED Client (Kiosk Fullscreen)
cd /d "%~dp0"
echo Starting LOKED Student Kiosk...
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0client\src\main.js"
