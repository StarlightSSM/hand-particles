@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" http://localhost:8790/hello.html
node server.js
