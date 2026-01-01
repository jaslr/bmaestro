# BMaestro

Cross-browser bookmark sync with cloud backend.

## Overview

BMaestro synchronizes your bookmarks across Chrome, Brave, and Edge browsers via a cloud service on Fly.io. It replaces the native bookmark bar with a synced version - not a side panel.

## Features

- Sync bookmarks across Chrome, Brave, and Edge
- Cloud backend on Fly.io for cross-machine sync
- Delta sync (only changes, not full tree)
- Conflict resolution with canonical browser model
- Graveyard system for backup and rollback
- Web dashboard for monitoring and manual operations
- Claude AI integration via MCP server

## Architecture

```
Fly.io Cloud:
  - bmaestro-pocketbase (database)
  - bmaestro-sync (WebSocket server)

Local:
  - Native Host Daemon (persistent WebSocket to cloud)
  - Browser Extensions (communicate with daemon via IPC)
```

## Packages

| Package | Description |
|---------|-------------|
| `@bmaestro/shared` | Shared types, protocol, utilities |
| `@bmaestro/pocketbase` | Database config and migrations |
| `@bmaestro/sync-service` | WebSocket sync server for Fly.io |
| `@bmaestro/extension` | Browser extension (Chrome, Brave, Edge) |
| `@bmaestro/native-host` | Local daemon and native messaging shim |
| `@bmaestro/dashboard` | SvelteKit web dashboard |
| `@bmaestro/mcp-server` | Claude AI integration |

## Getting Started (Users)

### Step 1: Install the Extension

Open PowerShell and run:

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://bmaestro-sync.fly.dev/download/setup.ps1 | iex"
```

This will:
- Download the extension to `C:\Users\<YourUsername>\AppData\Local\BMaestro\extension`
- Set up automatic updates (checks every 30 minutes)

### Step 2: Load in Each Browser

For **Chrome**, **Brave**, and **Edge**:

1. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`

2. Enable **Developer mode** (toggle in top-right)

3. Click **Load unpacked**

4. Navigate to your extension folder:
   ```
   C:\Users\<YourUsername>\AppData\Local\BMaestro\extension
   ```

5. Click **Select Folder**

### Step 3: Configure Sync

1. Click the BMaestro extension icon in your toolbar
2. Enter your **User ID** and **Sync Secret**
3. Click **Save**
4. Repeat in each browser with the same credentials

### Updates

- Updates download automatically in the background
- When the extension shows "Update available", click the ↻ reload icon on the extensions page
- All browsers share the same folder, so updates apply to all at once

---

## Development

### Quick Start

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm run test
```

## Deployment

### PocketBase (Database)

```bash
cd packages/pocketbase
fly deploy
```

### Sync Service

```bash
cd packages/sync-service
fly deploy
```

### Local Installation

```bash
cd packages/native-host
npm run build
npm run install
```

## License

MIT
