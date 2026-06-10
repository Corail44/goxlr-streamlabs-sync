@echo off
cd /d "%~dp0"
node src\index.js %*
echo.
pause
