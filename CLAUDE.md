# BMaestro - Cross-Browser Bookmark Sync

## Project Overview

BMaestro synchronizes bookmarks across Chrome, Brave, and Edge browsers via a cloud backend on Fly.io.

**Critical Constraint**: MUST sync the actual bookmark bar via `folderType: "bookmarks-bar"`, NOT hardcoded folder IDs which vary between browsers.

## Architecture

```
Fly.io Cloud:
  - bmaestro-pocketbase (database)
  - bmaestro-sync (WebSocket server)

Local:
  - Native Host Daemon (persistent WebSocket to cloud)
  - Browser Extensions (communicate with daemon via IPC)
```

## Package Structure

- `packages/shared` - Types, protocol, utilities
- `packages/pocketbase` - Database migrations and Fly.io config
- `packages/sync-service` - WebSocket server for Fly.io
- `packages/extension` - Manifest V3 browser extension
- `packages/native-host` - Local daemon + native messaging shim
- `packages/dashboard` - SvelteKit web UI
- `packages/mcp-server` - Claude AI integration

## Development Commands

```bash
# Install all dependencies
npm install

# Build all packages
npm run build

# Run tests
npm run test

# Type check
npm run typecheck
```

## Key Technical Constraints

### Native Messaging 1MB Limit
Messages over 900KB must be chunked:
```typescript
const CHUNK_SIZE = 900 * 1024;
```

### URL Normalization
Strip tracking params before comparison:
- utm_source, utm_medium, utm_campaign, utm_term, utm_content
- fbclid, gclid, ref

### Bookmark Bar Identification
```typescript
// CORRECT: Use folderType property
const bookmarksBar = tree.find(node => node.folderType === 'bookmarks-bar');

// WRONG: Hardcoded IDs vary by browser
const bookmarksBar = tree.find(node => node.id === '1'); // DON'T DO THIS
```

### Conflict Resolution
1. Canonical browser wins for same URL different title
2. Keep both for same title different URL
3. Deleted in canonical = delete everywhere
4. Deleted in non-canonical = queue for review

## Deployment

### PocketBase
```bash
cd packages/pocketbase
fly deploy
```

### Sync Service
```bash
cd packages/sync-service
fly deploy
```

## Fly.io Apps

- `bmaestro-pocketbase.fly.dev` - Database
- `bmaestro-sync.fly.dev` - WebSocket server

## Testing Strategy

- Unit tests with Vitest
- Integration tests for sync flows
- Manual testing with actual browsers

## Code Style

- TypeScript strict mode
- ESM modules
- Functional approach where possible
- Zod for runtime validation

## Important Files

- `packages/shared/src/types/` - Core type definitions
- `packages/shared/src/protocol/` - Message protocol
- `packages/sync-service/src/websocket/` - WebSocket handling
- `packages/extension/src/background.ts` - Service worker
- `packages/native-host/src/daemon.ts` - Persistent daemon
