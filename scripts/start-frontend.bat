@echo off
setlocal

set "ROOT_DIR=%~dp0.."
set "FRONTEND_DIR=%ROOT_DIR%\frontend"

if "%VITE_API_BASE_URL%"=="" set "VITE_API_BASE_URL=http://127.0.0.1:8080"

cd /d "%FRONTEND_DIR%"
npm run dev
