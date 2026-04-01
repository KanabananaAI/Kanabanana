@echo off
title Kanaban - Starting All Services
cd /d "%~dp0"

echo ============================================
echo   Kanaban - Starting All Services
echo ============================================
echo.
echo   [1] Server   (Express)   - port 3001
echo   [2] Client   (Vite)      - port 5173
echo   [3] Whisper  (FastAPI)   - port 3002
echo.
echo   Press Ctrl+C to stop all services
echo ============================================
echo.

npx concurrently -n server,client,whisper -c blue,green,magenta "npx tsx server/index.ts" "cd client && npm run dev" "python whisper/server.py"
