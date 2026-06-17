@echo off
setlocal
title Amanat Raspisanie Installer

cd /d "%~dp0"

if not exist "%~dp0install-windows.ps1" (
  echo install-windows.ps1 not found.
  echo Download full project folder or use GitHub Releases installer.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
if errorlevel 1 (
  echo.
  echo Installation failed.
  pause
  exit /b 1
)

echo.
echo Installation finished.
pause
