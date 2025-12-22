# BMaestro Windows Setup

This folder contains everything needed to run BMaestro on Windows with WSL.

## Prerequisites

- Windows with WSL2 (Ubuntu)
- Node.js installed in WSL
- BMaestro repo cloned to `/home/chip/bmaestro` in WSL
- Browsers: Chrome, Brave, and/or Edge

## Quick Start

### 1. Install Native Host (one-time)

Run in PowerShell as Administrator:

```powershell
powershell -ExecutionPolicy Bypass -File "\\wsl.localhost\ubuntu\home\chip\bmaestro\packages\native-host\windows-setup\install.ps1"
```

This registers the native messaging host for Chrome, Brave, and Edge.

### 2. Build the Daemon (one-time, or after updates)

```bash
# In WSL
cd /home/chip/bmaestro/packages/native-host
npm run build
```

### 3. Start the Daemon

**Option A: Double-click the .bat file**

Copy `start-bmaestro-daemon.bat` anywhere convenient and double-click it.

**Option B: From command line**

```cmd
wsl -d Ubuntu -e bash -c "cd /home/chip/bmaestro/packages/native-host && node dist/daemon.js"
```

## Auto-Start on Login

### Method 1: Startup Folder (Recommended)

1. Press `Win + R`, type `shell:startup`, press Enter
2. Copy `start-bmaestro-daemon.bat` to this folder
3. Done! Daemon starts when you log in

### Method 2: Task Scheduler (Hidden Window)

1. Open Task Scheduler (`taskschd.msc`)
2. Click "Create Basic Task"
3. Name: `BMaestro Daemon`
4. Trigger: "When I log on"
5. Action: "Start a program"
6. Program: `wsl.exe`
7. Arguments: `-d Ubuntu -e bash -c "cd /home/chip/bmaestro/packages/native-host && node dist/daemon.js"`
8. Finish

To run hidden, edit the task → check "Run whether user is logged on or not"

## StreamDeck Setup

The `start-bmaestro-daemon.bat` file uses absolute paths, so you can:

1. Copy it anywhere on your system
2. In StreamDeck, add a "System: Open" action
3. Point it to your copy of `start-bmaestro-daemon.bat`

**Tip:** The .bat keeps a window open showing daemon status. If you want it to run hidden, use the Task Scheduler method above and create a StreamDeck button that just triggers the scheduled task.

## Files in This Folder

| File | Purpose |
|------|---------|
| `install.ps1` | Registers native host in Windows registry |
| `com.bmaestro.native_host.json` | Native messaging manifest |
| `run-native-host.bat` | Shim called by Chrome to reach the daemon |
| `start-bmaestro-daemon.bat` | Starts the daemon (copy anywhere) |

## Troubleshooting

### Extension says "Native messaging host not found"
- Re-run `install.ps1` as Administrator
- Restart the browser completely

### Daemon won't start
- Check WSL is running: `wsl --status`
- Verify Node.js in WSL: `wsl -e node --version`
- Check the daemon was built: `ls /home/chip/bmaestro/packages/native-host/dist/`

### Connection issues
- Ensure daemon is running (keep the .bat window open)
- Check `~/.bmaestro/config.json` exists with your syncSecret

## Architecture

```
Chrome Extension
    ↓ (Native Messaging)
run-native-host.bat → shim.js
    ↓ (stdin/stdout)
daemon.js (running in WSL)
    ↓ (WebSocket)
bmaestro-sync.fly.dev (Cloud)
    ↓
bmaestro-pocketbase.fly.dev (Database)
```

The daemon must run locally because Chrome Native Messaging requires a local process. The daemon bridges between Chrome's security boundary and the cloud sync service.
