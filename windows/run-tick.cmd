@echo off
setlocal
cd /d "%~dp0.."
if not exist "logs" mkdir "logs"
where pnpm.cmd >nul 2>nul
if errorlevel 1 (
  echo ERROR: pnpm.cmd not found in PATH. Check Node.js / pnpm for this Windows user. >> "logs\scheduler.log"
  exit /b 1
)
call pnpm.cmd run tick >> "logs\scheduler.log" 2>&1
exit /b %ERRORLEVEL%
