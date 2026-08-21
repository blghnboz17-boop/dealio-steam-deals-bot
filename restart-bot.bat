@echo off
setlocal

set "PROJECT_ROOT=%~dp0."
echo [bot] Restart requested...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bot-control.ps1" -Action Restart -ProjectRoot "%PROJECT_ROOT%"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [bot] Restart failed with exit code %EXIT_CODE%.
)

echo.
pause
exit /b %EXIT_CODE%
