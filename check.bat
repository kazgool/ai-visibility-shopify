@echo off
REM Install dependencies, type-check, run the test suite. Safe to run anytime.
cd /d "%~dp0"
title AI Visibility - checks

echo.
echo === npm install ===
call npm install --no-audit --no-fund

echo.
echo === prisma generate ===
call npx prisma generate

echo.
echo === typescript ===
call npx tsc --noEmit
if errorlevel 1 (
  echo.
  echo TYPE ERRORS ABOVE - fix before testing.
  pause
  exit /b 1
)

echo.
echo === tests ===
call npm test

echo.
pause
