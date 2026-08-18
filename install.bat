@echo off
REM ===========================================================================
REM  Tally Connector installer
REM
REM  Run from an Administrator command prompt, in the repo folder:
REM      install.bat
REM
REM  Installs dependencies, builds, writes .env, registers a Windows service,
REM  and finishes with a health check so you know before you leave the desk.
REM ===========================================================================
setlocal enabledelayedexpansion

REM Work from the script's own folder, so it does not matter where it was run from.
cd /d "%~dp0"

set "SERVICE_NAME=TallyConnector"
set "APP_DIR=%CD%"
set "STARTUP_MODE=none"

echo.
echo === Tally Connector installer ===
echo Folder: %APP_DIR%
echo.

REM --- Administrator check -------------------------------------------------
net session >nul 2>&1
if errorlevel 1 goto :not_admin

REM --- Prerequisites -------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 goto :no_node
where npm >nul 2>&1
if errorlevel 1 goto :no_node

REM Resolve node.exe rather than assuming C:\Program Files\nodejs. Takes the
REM first match; `where` can print several when more than one is installed.
set "NODE_EXE="
for /f "delims=" %%i in ('where node 2^>nul') do (
  if not defined NODE_EXE set "NODE_EXE=%%i"
)
if not defined NODE_EXE goto :no_node

for /f "tokens=*" %%v in ('node --version') do set "NODE_VERSION=%%v"
echo [ok] node !NODE_VERSION!  ^(!NODE_EXE!^)

where git >nul 2>&1
if errorlevel 1 (
  echo [warn] git not found on PATH. Updates via /admin/update will not work.
) else (
  echo [ok] git found
)

REM --- Install dependencies ------------------------------------------------
echo.
echo [1/5] Installing dependencies ^(npm ci^)...
call npm ci
if errorlevel 1 goto :npm_failed

REM --- Build ---------------------------------------------------------------
echo.
echo [2/5] Building...
call npm run build
if errorlevel 1 goto :build_failed
if not exist "dist\server.js" goto :build_failed

REM --- Configuration -------------------------------------------------------
echo.
if exist ".env" goto :env_exists

echo [3/5] Creating .env
echo.
set "SHARED_SECRET="
set /p SHARED_SECRET=Shared secret - must match TALLY_CONNECTOR_SECRET on the backend:
if "!SHARED_SECRET!"=="" goto :no_secret

set "TALLY_COMPANY="
set /p TALLY_COMPANY=Exact Tally company name:
if "!TALLY_COMPANY!"=="" goto :no_company

set "TALLY_PORT="
set /p TALLY_PORT=Tally port [9000]:
if "!TALLY_PORT!"=="" set "TALLY_PORT=9000"

REM Redirection is written BEFORE the text on purpose. In `echo PORT=4000> .env`
REM cmd reads the trailing 0 as a file handle and redirects stdin instead, so any
REM value ending in a digit silently corrupts the line. Leading redirection is
REM immune to that.
>".env"  echo PORT=4000
>>".env" echo SHARED_SECRET=!SHARED_SECRET!
>>".env" echo TALLY_HOST=127.0.0.1
>>".env" echo TALLY_PORT=!TALLY_PORT!
>>".env" echo TALLY_TIMEOUT_MS=30000
>>".env" echo DEFAULT_COMPANY=!TALLY_COMPANY!
>>".env" echo TALLY_EDU_MODE=false
echo [ok] .env written
goto :after_env

:env_exists
echo [3/5] .env already present - keeping it.
echo       Delete it and re-run this script to reconfigure.

:after_env
if not exist "logs" mkdir "logs"

REM A wrapper the scheduler can point at as a single quoted path. Building the
REM equivalent command inline for schtasks /tr needs nested quotes, which cmd
REM does not let you escape reliably.
>"start-connector.cmd" echo @echo off
>>"start-connector.cmd" echo cd /d "%APP_DIR%"
>>"start-connector.cmd" echo "!NODE_EXE!" "%APP_DIR%\dist\server.js"

REM --- Register startup ----------------------------------------------------
echo.
echo [4/5] Registering startup...
where nssm >nul 2>&1
if errorlevel 1 goto :use_schtasks

REM NSSM is preferred: it restarts the process if it ever crashes.
nssm stop "%SERVICE_NAME%" >nul 2>&1
nssm remove "%SERVICE_NAME%" confirm >nul 2>&1
nssm install "%SERVICE_NAME%" "!NODE_EXE!" "%APP_DIR%\dist\server.js"
if errorlevel 1 goto :service_failed
nssm set "%SERVICE_NAME%" AppDirectory "%APP_DIR%"
nssm set "%SERVICE_NAME%" AppStdout "%APP_DIR%\logs\connector.log"
nssm set "%SERVICE_NAME%" AppStderr "%APP_DIR%\logs\connector-error.log"
nssm set "%SERVICE_NAME%" Start SERVICE_AUTO_START
nssm start "%SERVICE_NAME%"
if errorlevel 1 goto :service_failed
echo [ok] Windows service "%SERVICE_NAME%" installed and started ^(NSSM^)
set "STARTUP_MODE=nssm"
goto :health

:use_schtasks
REM Fallback so a missing NSSM does not waste the visit. Task Scheduler starts
REM the connector at boot but will NOT restart it if the process crashes.
echo [warn] NSSM not found on PATH - falling back to Task Scheduler.
echo        Startup will work, but a crashed process will NOT restart itself.
echo        For auto-restart: install NSSM from https://nssm.cc, add it to PATH,
echo        run uninstall.bat, then run this script again.
schtasks /delete /tn "%SERVICE_NAME%" /f >nul 2>&1
schtasks /create /tn "%SERVICE_NAME%" /tr "%APP_DIR%\start-connector.cmd" /sc onstart /ru SYSTEM /rl HIGHEST /f
if errorlevel 1 goto :service_failed
schtasks /run /tn "%SERVICE_NAME%" >nul 2>&1
echo [ok] Scheduled task "%SERVICE_NAME%" created and started
set "STARTUP_MODE=schtasks"

:health
echo.
echo [5/5] Health check...
REM Give the process a moment to bind before asking it anything.
timeout /t 5 /nobreak >nul
where curl >nul 2>&1
if errorlevel 1 goto :health_ps
curl -s --max-time 10 http://127.0.0.1:4000/health
goto :health_done

:health_ps
REM curl.exe ships with Windows 10 1803+; older builds fall back to PowerShell.
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 http://127.0.0.1:4000/health).Content } catch { 'health check failed: ' + $_.Exception.Message }"

:health_done
echo.
echo.
echo ============================================================
echo  Startup mode : !STARTUP_MODE!
echo.
echo  "tally":"connected"    -^> Tally answered. Done.
echo  "tally":"unreachable"  -^> open TallyPrime, load the company,
echo                            and enable the HTTP server under
echo                            F1 - Settings - Advanced Configuration.
echo                            It is OFF by default.
echo.
echo  No output at all       -^> the connector did not start.
echo                            Check logs\connector-error.log
echo ============================================================
goto :done

REM --- Failure paths -------------------------------------------------------
:not_admin
echo [ERROR] This must be run from an Administrator command prompt.
echo         Right-click Command Prompt and choose "Run as administrator".
goto :fail

:no_node
echo [ERROR] Node.js not found on PATH.
echo         Install Node 20 LTS or newer from https://nodejs.org, then reopen
echo         the command prompt and run this script again.
goto :fail

:npm_failed
echo [ERROR] npm ci failed. Check the output above - usually no network access
echo         or a proxy blocking the npm registry.
goto :fail

:build_failed
echo [ERROR] Build failed, or dist\server.js was not produced.
goto :fail

:no_secret
echo [ERROR] Shared secret cannot be empty. It must match TALLY_CONNECTOR_SECRET
echo         on the TMS backend, or every request is rejected with 401.
goto :fail

:no_company
echo [ERROR] Company name cannot be empty. It must match the Tally company name
echo         exactly, including spacing.
goto :fail

:service_failed
echo [ERROR] Could not register the connector to start automatically.
echo         The build is fine - you can still run it by hand with: npm start
goto :fail

:fail
echo.
endlocal
exit /b 1

:done
endlocal
exit /b 0
