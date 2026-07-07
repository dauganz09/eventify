@echo off
REM Eventify - Windows installer launcher.
REM Right-click this file and "Run as administrator" for a fresh install
REM (admin is needed the first time so PostgreSQL/Node can install).
setlocal
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
