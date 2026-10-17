@echo off
setlocal
cd /d "%~dp0"

title IAM — Inventory Action Manager
echo.
echo  IAM — pulling latest from GitHub, then starting on port 3002
echo  Folder: %CD%
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: git is not on PATH. Install Git for Windows, then try again.
  pause
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo ERROR: This folder is not a git repo: %CD%
  echo Put this bat inside your iam-distribution-app clone, or fix the Desktop shortcut target.
  pause
  exit /b 1
)

echo Checking out main...
git checkout main
if errorlevel 1 (
  echo WARNING: could not checkout main — continuing with current branch.
)

echo Pulling origin/main...
git pull origin main
if errorlevel 1 (
  echo.
  echo WARNING: git pull failed. Starting with whatever code is already in this folder.
  echo If the board still looks dark/old, fix network/auth and pull again.
  echo.
)

if not exist "node_modules\" (
  echo node_modules missing — running npm install...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo Starting IAM at http://127.0.0.1:3002 ...
echo Close this window to stop the server.
echo.
call npm run dev

echo.
echo IAM stopped.
pause
