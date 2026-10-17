@echo off
setlocal
cd /d "%~dp0"

title IAM — Fix and Start
echo.
echo  IAM — pull latest, repair Prisma/DB, then start on port 3002
echo  Folder: %CD%
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: git is not on PATH.
  pause
  exit /b 1
)

git checkout main
git pull origin main

echo Running npm install...
call npm install
if errorlevel 1 (
  echo ERROR: npm install failed.
  pause
  exit /b 1
)

echo Generating Prisma client...
call npx prisma generate
if errorlevel 1 (
  echo ERROR: prisma generate failed.
  pause
  exit /b 1
)

echo Pushing database schema...
call npm run db:push
if errorlevel 1 (
  echo ERROR: db:push failed.
  pause
  exit /b 1
)

echo.
echo Starting IAM at http://127.0.0.1:3002 ...
call npm run dev

echo.
echo IAM stopped.
pause
