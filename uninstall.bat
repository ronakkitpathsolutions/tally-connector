@echo off
REM ===========================================================================
REM  Removes the Tally Connector's startup registration.
REM
REM  Leaves .env, logs and the built files alone, so re-running install.bat
REM  puts things back without asking for the secret again.
REM ===========================================================================
setlocal
cd /d "%~dp0"

set "SERVICE_NAME=TallyConnector"

net session >nul 2>&1
if errorlevel 1 goto :not_admin

echo Removing "%SERVICE_NAME%"...

REM Both are attempted because install.bat picks whichever was available.
where nssm >nul 2>&1
if not errorlevel 1 (
  nssm stop "%SERVICE_NAME%" >nul 2>&1
  nssm remove "%SERVICE_NAME%" confirm >nul 2>&1
  echo [ok] NSSM service removed ^(if it existed^)
)

schtasks /query /tn "%SERVICE_NAME%" >nul 2>&1
if not errorlevel 1 (
  schtasks /end /tn "%SERVICE_NAME%" >nul 2>&1
  schtasks /delete /tn "%SERVICE_NAME%" /f >nul 2>&1
  echo [ok] Scheduled task removed
)

REM Anything still holding port 4000 would block a reinstall from starting.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4000" ^| findstr "LISTENING"') do (
  echo [info] Killing leftover process %%p still listening on 4000
  taskkill /f /pid %%p >nul 2>&1
)

if exist "start-connector.cmd" del /q "start-connector.cmd"

echo.
echo Done. .env, logs\ and dist\ were left in place.
echo Run install.bat to set it up again.
endlocal
exit /b 0

:not_admin
echo [ERROR] Run this from an Administrator command prompt.
endlocal
exit /b 1
