@echo off
title MassMusic
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm install || goto :error
)
if not exist dist\index.html (
  echo Building the app, first run only...
  call npm run build || goto :error
)
echo Starting MassMusic at http://localhost:4545  (close this window to stop it)
node server\index.js --open
goto :eof

:error
echo.
echo Something went wrong. Make sure Node.js 22.13 or newer is installed: https://nodejs.org
pause
