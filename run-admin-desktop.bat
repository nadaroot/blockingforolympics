@echo off
title LOKED Admin Desktop
cd /d "%~dp0"
echo Starting LOKED Teacher Desktop App...
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0admin-desktop\main.js"
