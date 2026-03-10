@echo off
setlocal

set "SCRIPT_DIR=%~dp0"

start "calorie-backend" cmd /c call "%SCRIPT_DIR%start-backend.bat"
timeout /t 2 >nul
call "%SCRIPT_DIR%start-frontend.bat"
