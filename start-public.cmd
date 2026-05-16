@echo off
setlocal
cd /d "%~dp0"

echo.
echo Building My Flash Drop for production...
call npm.cmd run build
if errorlevel 1 (
  echo.
  echo Build failed. Fix the error above before hosting.
  pause
  exit /b 1
)

echo.
echo Starting public server on all network interfaces...
echo Local: http://127.0.0.1:52895/
echo LAN:   use this PC's Wi-Fi IP, for example http://192.168.1.40:52895/
echo.
call npm.cmd run start
