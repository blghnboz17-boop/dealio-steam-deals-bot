@echo off
setlocal

if /i "%~1"=="--open-admin-url" (
    ping 127.0.0.1 -n 3 >nul
    start "" "https://localhost/admin/login"
    exit /b 0
)

set "PROJECT_ROOT=%~dp0."

if not exist "%PROJECT_ROOT%\caddy.exe" (
    echo caddy.exe proje klasorunde bulunamadi.
    pause
    exit /b 1
)

cd /d "%PROJECT_ROOT%"
call npm run build
if errorlevel 1 (
    echo.
    echo Admin paneli derlenemedi.
    pause
    exit /b 1
)

title Dealio Admin Panel

start "" /b /D "%PROJECT_ROOT%" cmd.exe /c "npm run admin:start"
timeout /t 2 /nobreak >nul
start "" /b cmd.exe /d /c call "%~f0" --open-admin-url

echo Admin paneli baslatildi.
echo Admin panelini kapatmak icin Ctrl+C tuslarina basin.
echo.
caddy.exe run --config Caddyfile
exit /b %ERRORLEVEL%
