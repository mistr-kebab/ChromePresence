@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found in PATH.
  echo Install Node.js 18 or newer from https://nodejs.org/ and try again.
  exit /b 1
)
node "%~dp0doctor.mjs" %*
exit /b %errorlevel%
