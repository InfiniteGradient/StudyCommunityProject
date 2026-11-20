@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Dependencies are not installed yet.
  echo Run: npm install
  pause
  exit /b 1
)
npm start
