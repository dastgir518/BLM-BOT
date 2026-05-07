@echo off
cd /d "%~dp0.."
if not exist logs mkdir logs
start "BiolecBotServer" /MIN cmd /c "node src\server.js > logs\server.out.log 2> logs\server.err.log"
echo Bio Lec bot server is starting. Check http://127.0.0.1:8787/health
