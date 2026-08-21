@echo off
setlocal

set "PROJECT_ROOT=%~dp0."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bot-control.ps1" -Action Stop -ProjectRoot "%PROJECT_ROOT%"

exit /b %ERRORLEVEL%
