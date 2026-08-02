@echo off
REM Starts the Shopify dev server (tunnel + Remix + theme extension).
REM Keep this window open while developing; press q to stop.
cd /d "%~dp0"
title AI Visibility - dev server
npm run dev
pause
