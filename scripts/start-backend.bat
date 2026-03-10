@echo off
setlocal

set "ROOT_DIR=%~dp0.."
set "BACKEND_DIR=%ROOT_DIR%\backend"

if "%DATABASE_URL%"=="" set "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/calorie_food"

cd /d "%BACKEND_DIR%"
python -m alembic -c alembic.ini upgrade head || exit /b 1
python -m uvicorn app.main:app --host 127.0.0.1 --port 8080
