@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-install.ps1" %*
set "result=%ERRORLEVEL%"
echo.
if not "%result%"=="0" echo Build or installation failed. See the error above.
pause
exit /b %result%
