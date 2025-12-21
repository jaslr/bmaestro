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

## Quick Start

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
