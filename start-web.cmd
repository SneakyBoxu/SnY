@echo off
REM ============================================================
REM  Cal In Cal Out - safe web server launcher
REM  Kills anything squatting on port 8081 (e.g. a hung Metro
REM  dev server from "expo start"), then serves the latest build.
REM ============================================================
echo Checking port 8081...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8081 ^| findstr LISTENING') do (
    echo   Killing stale process on port 8081 (PID %%a)
    taskkill /F /PID %%a >nul 2>&1
)

if not exist "%~dp0cal-in-cal-out\dist\index.html" (
    echo No build found! Run this first:
    echo   cd cal-in-cal-out ^&^& npx expo export --platform web --output-dir dist
    pause
    exit /b 1
)

echo Starting server...
start "Cal In Cal Out web" cmd /k "cd /d %~dp0cal-in-cal-out && node serve-web.mjs"
timeout /t 2 >nul
curl -s -o nul -w "Server check: HTTP %%{http_code}\n" http://localhost:8081
echo Open http://localhost:8081 in your browser.
