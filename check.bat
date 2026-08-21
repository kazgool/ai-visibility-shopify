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

REM The build is not optional here. A route that imports a .server module
REM outside its loader or action type-checks cleanly and passes every test,
REM then fails only when Remix splits client from server code - which used to
REM mean finding out on the deploy, after the version was already released.
echo.
echo === build ===
call npm run build
if errorlevel 1 (
  echo.
  echo BUILD FAILED - do not push.
  pause
  exit /b 1
)

echo.
pause
