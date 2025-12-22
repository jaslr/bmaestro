@echo off
REM BMaestro Daemon Starter
REM This file can be placed anywhere - it uses absolute WSL paths

title BMaestro Daemon
echo ========================================
echo   BMaestro Bookmark Sync Daemon
echo ========================================
echo.

REM Check if WSL is available
wsl --status >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] WSL is not installed or not running.
    echo.
    echo FIX: Install WSL with: wsl --install
    echo.
    pause
    exit /b 1
)

REM Check if Ubuntu distro exists
wsl -d Ubuntu -e echo "ok" >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Ubuntu WSL distro not found.
    echo.
    echo FIX: Install Ubuntu from Microsoft Store, or run: wsl --install -d Ubuntu
    echo.
    pause
    exit /b 1
)

REM Check if bmaestro repo exists
wsl -d Ubuntu -e test -d /home/chip/bmaestro
if %errorlevel% neq 0 (
    echo [ERROR] BMaestro repo not found at /home/chip/bmaestro
    echo.
    echo FIX: Clone the repo in WSL:
    echo   1. Open Ubuntu terminal
    echo   2. Run: git clone https://github.com/YOUR_REPO/bmaestro.git /home/chip/bmaestro
    echo   3. Run: cd /home/chip/bmaestro ^&^& npm install
    echo.
    pause
    exit /b 1
)

REM Check if daemon is built
wsl -d Ubuntu -e test -f /home/chip/bmaestro/packages/native-host/dist/daemon.js
if %errorlevel% neq 0 (
    echo [ERROR] Daemon not built. Building now...
    echo.
    wsl -d Ubuntu -e bash -c "cd /home/chip/bmaestro/packages/native-host && npm run build"
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Build failed. Try manually in WSL:
        echo   cd /home/chip/bmaestro/packages/native-host
        echo   npm install
        echo   npm run build
        echo.
        pause
        exit /b 1
    )
    echo Build complete.
    echo.
)

REM Check if config exists
wsl -d Ubuntu -e test -f /home/chip/.bmaestro/config.json
if %errorlevel% neq 0 (
    echo [WARNING] Config file not found at ~/.bmaestro/config.json
    echo Daemon may not authenticate with cloud service.
    echo.
)

REM Check if Node.js is available
wsl -d Ubuntu -e node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found in WSL.
    echo.
    echo FIX: Install Node.js in Ubuntu:
    echo   1. Open Ubuntu terminal
    echo   2. Run: curl -fsSL https://deb.nodesource.com/setup_20.x ^| sudo -E bash -
    echo   3. Run: sudo apt-get install -y nodejs
    echo.
    pause
    exit /b 1
)

echo All checks passed. Starting daemon...
echo Press Ctrl+C to stop
echo.

REM Run the daemon
wsl -d Ubuntu -e bash -c "cd /home/chip/bmaestro/packages/native-host && node dist/daemon.js"

REM If daemon exits, show why
echo.
echo ========================================
echo   Daemon stopped
echo ========================================
echo.
echo If this was unexpected, check:
echo   - Is the cloud service running? (bmaestro-sync.fly.dev)
echo   - Is your config valid? (~/.bmaestro/config.json)
echo.
pause
