@echo off
setlocal
cd /d "%~dp0"

title Install IAM Desktop Shortcut
set "APP_DIR=%CD%"
set "START_BAT=%APP_DIR%\Start IAM.bat"
set "DESKTOP=%USERPROFILE%\Desktop"
set "SHORTCUT=%DESKTOP%\IAM.lnk"

if not exist "%START_BAT%" (
  echo ERROR: Start IAM.bat not found in:
  echo   %APP_DIR%
  pause
  exit /b 1
)

echo Creating Desktop shortcut:
echo   %SHORTCUT%
echo Target:
echo   %START_BAT%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$s = $ws.CreateShortcut('%SHORTCUT%'); " ^
  "$s.TargetPath = '%START_BAT%'; " ^
  "$s.WorkingDirectory = '%APP_DIR%'; " ^
  "$s.WindowStyle = 1; " ^
  "$s.Description = 'IAM Decision Board — pulls latest main then starts on port 3002'; " ^
  "$s.Save()"

if errorlevel 1 (
  echo ERROR: could not create shortcut.
  pause
  exit /b 1
)

echo.
echo Done. Use the Desktop "IAM" shortcut ^(or your star button if it already
echo points at Start IAM.bat in this folder^).
echo.
echo First time after this install, double-click the new IAM shortcut once.
echo It will git pull main, then open http://127.0.0.1:3002
echo.
pause
