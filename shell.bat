@echo off
REM Opens PowerShell as administrator, already in the project folder.
powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoExit','-NoProfile','-Command','Set-Location ''%~dp0''; Write-Host ''AI Visibility - project shell'' -ForegroundColor Cyan'"
