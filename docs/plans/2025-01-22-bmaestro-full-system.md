# BMaestro Full System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build complete cross-browser bookmark sync system with cloud backend, native host daemon, browser extension, and dashboard.

**Architecture:** Extension captures bookmark events → Native Host daemon processes via IPC → WebSocket to cloud Sync Service → PocketBase persistence → Delta sync to other browsers

**Tech Stack:** TypeScript, Node.js, Vitest, ws (WebSocket), PocketBase, SvelteKit, Chrome Extension Manifest V3

---

## Phase 1: Sync Service (WebSocket Server)

The sync service runs on Fly.io and handles:
- WebSocket connections from native host daemons
- Device registration and authentication
- Operation broadcasting to connected devices
- Conflict detection and resolution

### Task 1.1: Sync Service Package Setup

**Files:**
- Create: `packages/sync-service/package.json`
- Create: `packages/sync-service/tsconfig.json`
- Create: `packages/sync-service/src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "@bmaestro/sync-service",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@bmaestro/shared": "workspace:*",
    "ws": "^8.16.0",
    "pocketbase": "^0.21.0",
    "dotenv": "^16.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/ws": "^8.5.10",
    "typescript": "^5.3.0",
    "tsx": "^4.7.0",
    "vitest": "^1.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create minimal src/index.ts**

```typescript
import { createServer } from 'http';

const PORT = parseInt(process.env.PORT ?? '8080', 10);

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`BMaestro Sync Service listening on port ${PORT}`);
});
```

**Step 4: Install dependencies and verify build**

Run: `cd packages/sync-service && npm install && npm run build`
Expected: Build succeeds, dist/index.js created

**Step 5: Commit**

```bash
git add packages/sync-service/
git commit -m "feat(sync-service): initialize package with health endpoint"
```

---

### Task 1.2: WebSocket Connection Manager

**Files:**
- Create: `packages/sync-service/src/websocket/connection-manager.ts`
- Create: `packages/sync-service/src/websocket/connection-manager.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/sync-service/src/websocket/connection-manager.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionManager, DeviceConnection } from './connection-manager.js';

describe('ConnectionManager', () => {
  let manager: ConnectionManager;

  beforeEach(() => {
    manager = new ConnectionManager();
  });

  it('registers a new device connection', () => {
    const mockSocket = { readyState: 1 } as any;

    manager.register('device-1', 'chrome', 'user-1', mockSocket);

    expect(manager.getDevice('device-1')).toBeDefined();
    expect(manager.getDevice('device-1')?.browserType).toBe('chrome');
  });

  it('returns undefined for unknown device', () => {
    expect(manager.getDevice('unknown')).toBeUndefined();
  });

  it('lists all devices for a user', () => {
    const mockSocket = { readyState: 1 } as any;

    manager.register('device-1', 'chrome', 'user-1', mockSocket);
    manager.register('device-2', 'brave', 'user-1', mockSocket);
    manager.register('device-3', 'edge', 'user-2', mockSocket);

    const user1Devices = manager.getDevicesForUser('user-1');
    expect(user1Devices).toHaveLength(2);
  });

  it('removes a device on disconnect', () => {
    const mockSocket = { readyState: 1 } as any;

    manager.register('device-1', 'chrome', 'user-1', mockSocket);
    manager.disconnect('device-1');

    expect(manager.getDevice('device-1')).toBeUndefined();
  });

  it('broadcasts message to all user devices except sender', () => {
    const messages: string[] = [];
    const mockSocket1 = {
      readyState: 1,
      send: (msg: string) => messages.push(`1:${msg}`)
    } as any;
    const mockSocket2 = {
      readyState: 1,
      send: (msg: string) => messages.push(`2:${msg}`)
    } as any;

    manager.register('device-1', 'chrome', 'user-1', mockSocket1);
    manager.register('device-2', 'brave', 'user-1', mockSocket2);

    manager.broadcastToUser('user-1', '{"test": true}', 'device-1');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe('2:{"test": true}');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/sync-service && npm test`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// packages/sync-service/src/websocket/connection-manager.ts
import type { WebSocket } from 'ws';
import type { BrowserType } from '@bmaestro/shared/types';

export interface DeviceConnection {
  deviceId: string;
  browserType: BrowserType;
  userId: string;
  socket: WebSocket;
  connectedAt: Date;
  lastSeen: Date;
}

export class ConnectionManager {
  private devices = new Map<string, DeviceConnection>();
  private userDevices = new Map<string, Set<string>>();

  register(
    deviceId: string,
    browserType: BrowserType,
    userId: string,
    socket: WebSocket
  ): void {
    const connection: DeviceConnection = {
      deviceId,
      browserType,
      userId,
      socket,
      connectedAt: new Date(),
      lastSeen: new Date(),
    };

    this.devices.set(deviceId, connection);

    if (!this.userDevices.has(userId)) {
      this.userDevices.set(userId, new Set());
    }
    this.userDevices.get(userId)!.add(deviceId);
  }

  getDevice(deviceId: string): DeviceConnection | undefined {
    return this.devices.get(deviceId);
  }

  getDevicesForUser(userId: string): DeviceConnection[] {
    const deviceIds = this.userDevices.get(userId);
    if (!deviceIds) return [];

    return Array.from(deviceIds)
      .map(id => this.devices.get(id))
      .filter((d): d is DeviceConnection => d !== undefined);
  }

  disconnect(deviceId: string): void {
    const connection = this.devices.get(deviceId);
    if (!connection) return;

    this.devices.delete(deviceId);
    this.userDevices.get(connection.userId)?.delete(deviceId);
  }

  broadcastToUser(userId: string, message: string, excludeDeviceId?: string): void {
    const devices = this.getDevicesForUser(userId);

    for (const device of devices) {
      if (device.deviceId === excludeDeviceId) continue;
      if (device.socket.readyState !== 1) continue; // OPEN = 1

      device.socket.send(message);
    }
  }

  updateLastSeen(deviceId: string): void {
    const connection = this.devices.get(deviceId);
    if (connection) {
      connection.lastSeen = new Date();
    }
  }

  getConnectionCount(): number {
    return this.devices.size;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/sync-service && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sync-service/src/websocket/
git commit -m "feat(sync-service): add WebSocket connection manager"
```

---

### Task 1.3: Message Handler

**Files:**
- Create: `packages/sync-service/src/websocket/message-handler.ts`
- Create: `packages/sync-service/src/websocket/message-handler.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/sync-service/src/websocket/message-handler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageHandler } from './message-handler.js';
import { ConnectionManager } from './connection-manager.js';

describe('MessageHandler', () => {
  let handler: MessageHandler;
  let connectionManager: ConnectionManager;
  let mockSocket: any;

  beforeEach(() => {
    connectionManager = new ConnectionManager();
    handler = new MessageHandler(connectionManager);
    mockSocket = {
      readyState: 1,
      send: vi.fn(),
    };
  });

  it('handles PING with PONG response', () => {
    connectionManager.register('device-1', 'chrome', 'user-1', mockSocket);

    handler.handleMessage('device-1', JSON.stringify({ type: 'PING' }));

    expect(mockSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'PONG' })
    );
  });

  it('handles REGISTER_DEVICE message', () => {
    handler.handleMessage('device-1', JSON.stringify({
      type: 'REGISTER_DEVICE',
      deviceId: 'device-1',
      browserType: 'chrome',
      deviceName: 'My Chrome',
    }), mockSocket, 'user-1');

    expect(connectionManager.getDevice('device-1')).toBeDefined();
  });

  it('handles CHECK_IN message', () => {
    connectionManager.register('device-1', 'chrome', 'user-1', mockSocket);

    handler.handleMessage('device-1', JSON.stringify({
      type: 'CHECK_IN',
      deviceId: 'device-1',
      lastSyncVersion: 0,
    }));

    // Should respond with SYNC_DELTA (even if empty)
    expect(mockSocket.send).toHaveBeenCalled();
    const response = JSON.parse(mockSocket.send.mock.calls[0][0]);
    expect(response.type).toBe('SYNC_DELTA');
  });

  it('sends ERROR for invalid message format', () => {
    connectionManager.register('device-1', 'chrome', 'user-1', mockSocket);

    handler.handleMessage('device-1', 'not valid json');

    expect(mockSocket.send).toHaveBeenCalled();
    const response = JSON.parse(mockSocket.send.mock.calls[0][0]);
    expect(response.type).toBe('ERROR');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/sync-service && npm test`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// packages/sync-service/src/websocket/message-handler.ts
import type { WebSocket } from 'ws';
import { WSClientMessage, WSServerMessage } from '@bmaestro/shared/types';
import type { ConnectionManager } from './connection-manager.js';

export class MessageHandler {
  constructor(private connectionManager: ConnectionManager) {}

  handleMessage(
    deviceId: string,
    rawMessage: string,
    socket?: WebSocket,
    userId?: string
  ): void {
    let parsed: WSClientMessage;

    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      this.sendError(deviceId, 'INVALID_JSON', 'Message is not valid JSON');
      return;
    }

    // Validate message structure
    const result = WSClientMessage.safeParse(parsed);
    if (!result.success) {
      this.sendError(deviceId, 'INVALID_MESSAGE', 'Invalid message format');
      return;
    }

    const message = result.data;

    switch (message.type) {
      case 'PING':
        this.handlePing(deviceId);
        break;

      case 'REGISTER_DEVICE':
        if (socket && userId) {
          this.handleRegister(deviceId, message, socket, userId);
        }
        break;

      case 'CHECK_IN':
        this.handleCheckIn(deviceId, message);
        break;

      case 'SYNC_OPS':
        this.handleSyncOps(deviceId, message);
        break;

      case 'CHUNK_START':
      case 'CHUNK_DATA':
      case 'CHUNK_END':
        this.handleChunk(deviceId, message);
        break;
    }
  }

  private handlePing(deviceId: string): void {
    this.send(deviceId, { type: 'PONG' });
  }

  private handleRegister(
    deviceId: string,
    message: Extract<WSClientMessage, { type: 'REGISTER_DEVICE' }>,
    socket: WebSocket,
    userId: string
  ): void {
    this.connectionManager.register(
      message.deviceId,
      message.browserType,
      userId,
      socket
    );
    this.send(deviceId, { type: 'ACK', requestId: deviceId });
  }

  private handleCheckIn(
    deviceId: string,
    message: Extract<WSClientMessage, { type: 'CHECK_IN' }>
  ): void {
    this.connectionManager.updateLastSeen(deviceId);

    // TODO: Query database for operations since lastSyncVersion
    this.send(deviceId, {
      type: 'SYNC_DELTA',
      operations: [],
      currentVersion: message.lastSyncVersion,
      yourVersion: message.lastSyncVersion,
    });
  }

  private handleSyncOps(
    deviceId: string,
    message: Extract<WSClientMessage, { type: 'SYNC_OPS' }>
  ): void {
    const device = this.connectionManager.getDevice(deviceId);
    if (!device) return;

    // TODO: Persist operations to database
    // TODO: Detect conflicts
    // Broadcast to other devices
    this.connectionManager.broadcastToUser(
      device.userId,
      JSON.stringify({
        type: 'SYNC_DELTA',
        operations: message.operations,
        currentVersion: Date.now(),
        yourVersion: Date.now(),
      }),
      deviceId
    );

    this.send(deviceId, { type: 'ACK', requestId: deviceId });
  }

  private handleChunk(
    deviceId: string,
    message: Extract<WSClientMessage, { type: 'CHUNK_START' | 'CHUNK_DATA' | 'CHUNK_END' }>
  ): void {
    // TODO: Implement chunk accumulation
    if (message.type === 'CHUNK_DATA') {
      this.send(deviceId, {
        type: 'CHUNK_ACK',
        chunkId: message.chunkId,
        receivedChunks: message.index + 1,
      });
    }
  }

  private send(deviceId: string, message: WSServerMessage): void {
    const device = this.connectionManager.getDevice(deviceId);
    if (!device || device.socket.readyState !== 1) return;

    device.socket.send(JSON.stringify(message));
  }

  private sendError(deviceId: string, code: string, message: string): void {
    this.send(deviceId, { type: 'ERROR', code, message });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/sync-service && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sync-service/src/websocket/
git commit -m "feat(sync-service): add WebSocket message handler"
```

---

### Task 1.4: WebSocket Server Integration

**Files:**
- Create: `packages/sync-service/src/websocket/server.ts`
- Modify: `packages/sync-service/src/index.ts`

**Step 1: Create WebSocket server wrapper**

```typescript
// packages/sync-service/src/websocket/server.ts
import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { ConnectionManager } from './connection-manager.js';
import { MessageHandler } from './message-handler.js';

export interface WebSocketServerOptions {
  httpServer: HttpServer;
}

export function createWebSocketServer(options: WebSocketServerOptions): {
  wss: WebSocketServer;
  connectionManager: ConnectionManager;
} {
  const connectionManager = new ConnectionManager();
  const messageHandler = new MessageHandler(connectionManager);

  const wss = new WebSocketServer({
    server: options.httpServer,
    path: '/ws',
  });

  wss.on('connection', (socket: WebSocket, req) => {
    // Extract device ID from query params or generate temporary one
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    const deviceId = url.searchParams.get('deviceId') ?? `temp-${Date.now()}`;
    const userId = url.searchParams.get('userId') ?? 'anonymous';

    console.log(`[WS] Connection from device: ${deviceId}`);

    socket.on('message', (data) => {
      const message = data.toString();
      messageHandler.handleMessage(deviceId, message, socket, userId);
    });

    socket.on('close', () => {
      console.log(`[WS] Disconnected: ${deviceId}`);
      connectionManager.disconnect(deviceId);
    });

    socket.on('error', (error) => {
      console.error(`[WS] Error for ${deviceId}:`, error.message);
    });

    // Send initial ACK
    socket.send(JSON.stringify({ type: 'ACK', requestId: 'connect' }));
  });

  return { wss, connectionManager };
}
```

**Step 2: Update index.ts to integrate WebSocket**

```typescript
// packages/sync-service/src/index.ts
import { createServer } from 'http';
import { createWebSocketServer } from './websocket/server.js';

const PORT = parseInt(process.env.PORT ?? '8080', 10);

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      connections: connectionManager.getConnectionCount(),
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const { connectionManager } = createWebSocketServer({ httpServer: server });

server.listen(PORT, () => {
  console.log(`BMaestro Sync Service listening on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
});
```

**Step 3: Create websocket index export**

```typescript
// packages/sync-service/src/websocket/index.ts
export { ConnectionManager, type DeviceConnection } from './connection-manager.js';
export { MessageHandler } from './message-handler.js';
export { createWebSocketServer, type WebSocketServerOptions } from './server.js';
```

**Step 4: Build and verify**

Run: `cd packages/sync-service && npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add packages/sync-service/
git commit -m "feat(sync-service): integrate WebSocket server with HTTP"
```

---

### Task 1.5: Fly.io Deployment Configuration

**Files:**
- Create: `packages/sync-service/Dockerfile`
- Create: `packages/sync-service/fly.toml`
- Create: `packages/sync-service/.dockerignore`

**Step 1: Create Dockerfile**

```dockerfile
# packages/sync-service/Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/sync-service/package*.json ./packages/sync-service/

# Install dependencies
RUN npm install

# Copy source
COPY packages/shared/ ./packages/shared/
COPY packages/sync-service/ ./packages/sync-service/

# Build shared first, then sync-service
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/sync-service

# Production image
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages/shared/package*.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist/ ./packages/shared/dist/
COPY --from=builder /app/packages/sync-service/package*.json ./packages/sync-service/
COPY --from=builder /app/packages/sync-service/dist/ ./packages/sync-service/dist/

RUN npm install --omit=dev

EXPOSE 8080

CMD ["node", "packages/sync-service/dist/index.js"]
```

**Step 2: Create fly.toml**

```toml
# packages/sync-service/fly.toml
app = 'bmaestro-sync'
primary_region = 'syd'

[build]

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'stop'
  auto_start_machines = true
  min_machines_running = 0
  processes = ['app']

[[services]]
  protocol = 'tcp'
  internal_port = 8080

  [[services.ports]]
    port = 443
    handlers = ['tls', 'http']

  [[services.ports]]
    port = 80
    handlers = ['http']

[[vm]]
  memory = '256mb'
  cpu_kind = 'shared'
  cpus = 1
```

**Step 3: Create .dockerignore**

```
# packages/sync-service/.dockerignore
node_modules
dist
*.log
.env*
```

**Step 4: Commit**

```bash
git add packages/sync-service/Dockerfile packages/sync-service/fly.toml packages/sync-service/.dockerignore
git commit -m "feat(sync-service): add Fly.io deployment configuration"
```

---

## Phase 2: Native Host Daemon

The native host daemon:
- Runs as a persistent local process
- Maintains WebSocket connection to cloud sync service
- Communicates with browser extensions via native messaging protocol
- Handles message chunking for large bookmark trees

### Task 2.1: Native Host Package Setup

**Files:**
- Create: `packages/native-host/package.json`
- Create: `packages/native-host/tsconfig.json`
- Create: `packages/native-host/src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "@bmaestro/native-host",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "bmaestro-daemon": "./dist/daemon.js",
    "bmaestro-shim": "./dist/shim.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/daemon.js",
    "dev": "tsx watch src/daemon.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@bmaestro/shared": "workspace:*",
    "ws": "^8.16.0",
    "conf": "^12.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/ws": "^8.5.10",
    "typescript": "^5.3.0",
    "tsx": "^4.7.0",
    "vitest": "^1.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create minimal src/index.ts**

```typescript
// packages/native-host/src/index.ts
export const VERSION = '1.0.0';
console.log(`BMaestro Native Host v${VERSION}`);
```

**Step 4: Install and verify build**

Run: `cd packages/native-host && npm install && npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add packages/native-host/
git commit -m "feat(native-host): initialize package"
```

---

### Task 2.2: Native Messaging Protocol Handler

**Files:**
- Create: `packages/native-host/src/native-messaging.ts`
- Create: `packages/native-host/src/native-messaging.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/native-host/src/native-messaging.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeMessaging } from './native-messaging.js';
import { Readable, Writable } from 'stream';

describe('NativeMessaging', () => {
  it('reads a message with length prefix', async () => {
    // Create a buffer with length-prefixed message
    const message = { test: 'hello' };
    const json = JSON.stringify(message);
    const buffer = Buffer.alloc(4 + json.length);
    buffer.writeUInt32LE(json.length, 0);
    buffer.write(json, 4);

    const readable = Readable.from([buffer]);
    const writable = new Writable({ write: () => {} });

    const nm = new NativeMessaging(readable, writable);
    const received = await nm.read();

    expect(received).toEqual(message);
  });

  it('writes a message with length prefix', async () => {
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, _, callback) {
        chunks.push(chunk);
        callback();
      }
    });
    const readable = new Readable({ read: () => {} });

    const nm = new NativeMessaging(readable, writable);
    await nm.write({ test: 'hello' });

    const combined = Buffer.concat(chunks);
    const length = combined.readUInt32LE(0);
    const json = combined.slice(4, 4 + length).toString();

    expect(JSON.parse(json)).toEqual({ test: 'hello' });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/native-host && npm test`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// packages/native-host/src/native-messaging.ts
import { Readable, Writable } from 'stream';

/**
 * Native Messaging protocol handler
 * Chrome's native messaging uses length-prefixed JSON messages
 */
export class NativeMessaging {
  private buffer = Buffer.alloc(0);
  private pendingReads: Array<{
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(
    private input: Readable,
    private output: Writable
  ) {
    this.input.on('data', (chunk: Buffer) => this.onData(chunk));
    this.input.on('end', () => this.onEnd());
    this.input.on('error', (err) => this.onError(err));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.processBuffer();
  }

  private onEnd(): void {
    for (const pending of this.pendingReads) {
      pending.reject(new Error('Stream ended'));
    }
    this.pendingReads = [];
  }

  private onError(error: Error): void {
    for (const pending of this.pendingReads) {
      pending.reject(error);
    }
    this.pendingReads = [];
  }

  private processBuffer(): void {
    while (this.buffer.length >= 4) {
      const messageLength = this.buffer.readUInt32LE(0);

      if (this.buffer.length < 4 + messageLength) {
        break; // Wait for more data
      }

      const json = this.buffer.slice(4, 4 + messageLength).toString('utf-8');
      this.buffer = this.buffer.slice(4 + messageLength);

      try {
        const message = JSON.parse(json);
        const pending = this.pendingReads.shift();
        if (pending) {
          pending.resolve(message);
        }
      } catch (error) {
        const pending = this.pendingReads.shift();
        if (pending) {
          pending.reject(error as Error);
        }
      }
    }
  }

  read<T = unknown>(): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pendingReads.push({
        resolve: resolve as (value: unknown) => void,
        reject
      });
      this.processBuffer();
    });
  }

  write(message: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const json = JSON.stringify(message);
      const buffer = Buffer.alloc(4 + Buffer.byteLength(json, 'utf-8'));
      buffer.writeUInt32LE(Buffer.byteLength(json, 'utf-8'), 0);
      buffer.write(json, 4, 'utf-8');

      this.output.write(buffer, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/native-host && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/native-host/src/native-messaging*
git commit -m "feat(native-host): add native messaging protocol handler"
```

---

### Task 2.3: Cloud Connection Manager

**Files:**
- Create: `packages/native-host/src/cloud-connection.ts`
- Create: `packages/native-host/src/cloud-connection.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/native-host/src/cloud-connection.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudConnection, ConnectionState } from './cloud-connection.js';

describe('CloudConnection', () => {
  it('starts in disconnected state', () => {
    const connection = new CloudConnection({
      url: 'ws://localhost:8080/ws',
      deviceId: 'test-device',
      userId: 'test-user',
    });

    expect(connection.state).toBe('disconnected');
  });

  it('emits state changes', async () => {
    const states: ConnectionState[] = [];
    const connection = new CloudConnection({
      url: 'ws://localhost:8080/ws',
      deviceId: 'test-device',
      userId: 'test-user',
      reconnectInterval: 100,
    });

    connection.on('stateChange', (state) => states.push(state));

    // Don't actually connect, just verify event system works
    connection.emit('stateChange', 'connecting');
    connection.emit('stateChange', 'connected');

    expect(states).toEqual(['connecting', 'connected']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/native-host && npm test`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// packages/native-host/src/cloud-connection.ts
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { WSClientMessage, WSServerMessage } from '@bmaestro/shared/types';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface CloudConnectionOptions {
  url: string;
  deviceId: string;
  userId: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export class CloudConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private _state: ConnectionState = 'disconnected';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;

  constructor(private options: CloudConnectionOptions) {
    super();
  }

  get state(): ConnectionState {
    return this._state;
  }

  private setState(state: ConnectionState): void {
    if (this._state !== state) {
      this._state = state;
      this.emit('stateChange', state);
    }
  }

  connect(): void {
    if (this._state === 'connected' || this._state === 'connecting') {
      return;
    }

    this.setState('connecting');

    const url = new URL(this.options.url);
    url.searchParams.set('deviceId', this.options.deviceId);
    url.searchParams.set('userId', this.options.userId);

    this.ws = new WebSocket(url.toString());

    this.ws.on('open', () => {
      this.reconnectAttempts = 0;
      this.setState('connected');
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as WSServerMessage;
        this.emit('message', message);
      } catch (error) {
        this.emit('error', error);
      }
    });

    this.ws.on('close', () => {
      this.ws = null;
      this.setState('disconnected');
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      this.emit('error', error);
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setState('disconnected');
  }

  send(message: WSClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.emit('error', new Error('Not connected'));
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  private scheduleReconnect(): void {
    const maxAttempts = this.options.maxReconnectAttempts ?? 10;
    if (this.reconnectAttempts >= maxAttempts) {
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    const interval = this.options.reconnectInterval ?? 5000;
    const delay = Math.min(interval * Math.pow(2, this.reconnectAttempts), 60000);

    this.setState('reconnecting');
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  ping(): void {
    this.send({ type: 'PING' });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/native-host && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/native-host/src/cloud-connection*
git commit -m "feat(native-host): add cloud WebSocket connection manager"
```

---

### Task 2.4: Daemon Main Process

**Files:**
- Create: `packages/native-host/src/daemon.ts`

**Step 1: Create daemon implementation**

```typescript
// packages/native-host/src/daemon.ts
import { CloudConnection } from './cloud-connection.js';
import { NativeMessaging } from './native-messaging.js';
import { NativeRequest, NativeResponse, WSServerMessage } from '@bmaestro/shared/types';
import { ChunkAccumulator, chunkMessage } from '@bmaestro/shared/protocol';
import { randomUUID } from 'crypto';

const SYNC_SERVICE_URL = process.env.SYNC_SERVICE_URL ?? 'wss://bmaestro-sync.fly.dev/ws';
const DEVICE_ID = process.env.DEVICE_ID ?? `device-${randomUUID().slice(0, 8)}`;
const USER_ID = process.env.USER_ID ?? 'default-user';

console.log(`[Daemon] Starting BMaestro Native Host Daemon`);
console.log(`[Daemon] Device ID: ${DEVICE_ID}`);
console.log(`[Daemon] Sync Service: ${SYNC_SERVICE_URL}`);

// Initialize cloud connection
const cloud = new CloudConnection({
  url: SYNC_SERVICE_URL,
  deviceId: DEVICE_ID,
  userId: USER_ID,
});

// Track connected extensions (browser -> NativeMessaging instance)
const extensions = new Map<string, NativeMessaging>();
const chunkAccumulator = new ChunkAccumulator();

// Handle messages from cloud
cloud.on('message', (message: WSServerMessage) => {
  console.log(`[Daemon] Cloud message: ${message.type}`);

  // Forward to all connected extensions
  for (const [browser, nm] of extensions) {
    const response: NativeResponse = {
      id: randomUUID(),
      type: message.type === 'SYNC_DELTA' ? 'SYNC_DELTA' : 'ACK',
      payload: message as unknown as Record<string, unknown>,
    };

    // Chunk if necessary
    const chunks = chunkMessage(response);
    for (const chunk of chunks) {
      nm.write(chunk).catch((err) => {
        console.error(`[Daemon] Error sending to ${browser}:`, err);
      });
    }
  }
});

cloud.on('connected', () => {
  console.log('[Daemon] Connected to cloud');
});

cloud.on('disconnected', () => {
  console.log('[Daemon] Disconnected from cloud');
});

cloud.on('error', (error: Error) => {
  console.error('[Daemon] Cloud error:', error.message);
});

// Connect to cloud
cloud.connect();

// Keep process alive
process.on('SIGINT', () => {
  console.log('[Daemon] Shutting down...');
  cloud.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Daemon] Shutting down...');
  cloud.disconnect();
  process.exit(0);
});

// Export for native messaging shim to connect
export { cloud, extensions, chunkAccumulator };
```

**Step 2: Build and verify**

Run: `cd packages/native-host && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/native-host/src/daemon.ts
git commit -m "feat(native-host): add daemon main process"
```

---

### Task 2.5: Native Messaging Shim

**Files:**
- Create: `packages/native-host/src/shim.ts`

The shim is the entry point Chrome launches via native messaging. It forwards messages to/from the daemon.

**Step 1: Create shim implementation**

```typescript
// packages/native-host/src/shim.ts
#!/usr/bin/env node
import { NativeMessaging } from './native-messaging.js';
import { NativeRequest, NativeResponse, BrowserType } from '@bmaestro/shared/types';
import { ChunkAccumulator, chunkMessage, type MessageChunk } from '@bmaestro/shared/protocol';
import { randomUUID } from 'crypto';
import net from 'net';

const DAEMON_SOCKET_PATH = process.env.DAEMON_SOCKET ?? '/tmp/bmaestro-daemon.sock';

// Initialize native messaging with stdin/stdout
const nm = new NativeMessaging(process.stdin, process.stdout);
const chunkAccumulator = new ChunkAccumulator();

// Track pending requests
const pendingRequests = new Map<string, {
  resolve: (response: NativeResponse) => void;
  timeout: NodeJS.Timeout;
}>();

// Connect to daemon via Unix socket
let daemonSocket: net.Socket | null = null;

function connectToDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    daemonSocket = net.createConnection(DAEMON_SOCKET_PATH, () => {
      console.error('[Shim] Connected to daemon');
      resolve();
    });

    daemonSocket.on('error', (err) => {
      console.error('[Shim] Daemon connection error:', err.message);
      // Continue without daemon - extension can still work offline
      resolve();
    });

    daemonSocket.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString()) as NativeResponse;
        handleDaemonResponse(response);
      } catch (err) {
        console.error('[Shim] Error parsing daemon response:', err);
      }
    });

    daemonSocket.on('close', () => {
      console.error('[Shim] Daemon disconnected');
      daemonSocket = null;
    });
  });
}

function handleDaemonResponse(response: NativeResponse): void {
  // Forward response to extension
  const chunks = chunkMessage(response);
  for (const chunk of chunks) {
    nm.write(chunk).catch((err) => {
      console.error('[Shim] Error writing to extension:', err);
    });
  }
}

async function handleExtensionMessage(message: unknown): Promise<void> {
  // Check if it's a chunk
  if (typeof message === 'object' && message !== null && 'type' in message) {
    const msg = message as { type: string };

    if (msg.type === 'CHUNK') {
      const chunk = message as MessageChunk;
      const complete = chunkAccumulator.addChunk<NativeRequest>(chunk);
      if (complete) {
        await processRequest(complete);
      }
      return;
    }

    if (msg.type === 'SINGLE') {
      const single = message as { type: 'SINGLE'; data: NativeRequest };
      await processRequest(single.data);
      return;
    }
  }

  // Treat as direct request
  await processRequest(message as NativeRequest);
}

async function processRequest(request: NativeRequest): Promise<void> {
  console.error(`[Shim] Request: ${request.type}`);

  // Handle locally if possible
  if (request.type === 'GET_STATUS') {
    const response: NativeResponse = {
      id: request.id,
      type: 'STATUS',
      payload: {
        connected: daemonSocket !== null,
        version: '1.0.0',
      },
    };
    await nm.write({ type: 'SINGLE', data: response });
    return;
  }

  // Forward to daemon
  if (daemonSocket) {
    daemonSocket.write(JSON.stringify(request));
  } else {
    // Offline mode - acknowledge but note we're not syncing
    const response: NativeResponse = {
      id: request.id,
      type: 'ACK',
      payload: { offline: true },
    };
    await nm.write({ type: 'SINGLE', data: response });
  }
}

// Main loop
async function main(): Promise<void> {
  await connectToDaemon();

  // Process messages from extension
  while (true) {
    try {
      const message = await nm.read();
      await handleExtensionMessage(message);
    } catch (err) {
      if ((err as Error).message === 'Stream ended') {
        break;
      }
      console.error('[Shim] Error:', err);
    }
  }
}

main().catch((err) => {
  console.error('[Shim] Fatal error:', err);
  process.exit(1);
});
```

**Step 2: Build and verify**

Run: `cd packages/native-host && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/native-host/src/shim.ts
git commit -m "feat(native-host): add native messaging shim for browser communication"
```

---

### Task 2.6: Native Host Manifest Generator

**Files:**
- Create: `packages/native-host/src/install.ts`

**Step 1: Create installation script**

```typescript
// packages/native-host/src/install.ts
#!/usr/bin/env node
import { writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, platform } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MANIFEST_NAME = 'com.bmaestro.native_host';

interface BrowserConfig {
  name: string;
  manifestPath: string;
}

function getBrowserConfigs(): BrowserConfig[] {
  const home = homedir();
  const os = platform();

  if (os === 'darwin') {
    return [
      {
        name: 'chrome',
        manifestPath: join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
      },
      {
        name: 'brave',
        manifestPath: join(home, 'Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts'),
      },
      {
        name: 'edge',
        manifestPath: join(home, 'Library/Application Support/Microsoft Edge/NativeMessagingHosts'),
      },
    ];
  }

  if (os === 'linux') {
    return [
      {
        name: 'chrome',
        manifestPath: join(home, '.config/google-chrome/NativeMessagingHosts'),
      },
      {
        name: 'brave',
        manifestPath: join(home, '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts'),
      },
      {
        name: 'edge',
        manifestPath: join(home, '.config/microsoft-edge/NativeMessagingHosts'),
      },
    ];
  }

  if (os === 'win32') {
    // Windows uses registry, but we can also use per-user manifests
    const appData = process.env.LOCALAPPDATA ?? join(home, 'AppData/Local');
    return [
      {
        name: 'chrome',
        manifestPath: join(appData, 'Google/Chrome/User Data/NativeMessagingHosts'),
      },
      {
        name: 'brave',
        manifestPath: join(appData, 'BraveSoftware/Brave-Browser/User Data/NativeMessagingHosts'),
      },
      {
        name: 'edge',
        manifestPath: join(appData, 'Microsoft/Edge/User Data/NativeMessagingHosts'),
      },
    ];
  }

  throw new Error(`Unsupported platform: ${os}`);
}

function createManifest(extensionId: string, shimPath: string): object {
  return {
    name: MANIFEST_NAME,
    description: 'BMaestro Bookmark Sync Native Host',
    path: shimPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

function install(extensionIds: Record<string, string>): void {
  const configs = getBrowserConfigs();
  const shimPath = join(__dirname, 'shim.js');

  // Make shim executable on Unix
  if (platform() !== 'win32') {
    try {
      chmodSync(shimPath, 0o755);
    } catch {
      // Ignore if already executable
    }
  }

  for (const config of configs) {
    const extensionId = extensionIds[config.name];
    if (!extensionId) {
      console.log(`Skipping ${config.name} - no extension ID provided`);
      continue;
    }

    const manifest = createManifest(extensionId, shimPath);
    const manifestPath = join(config.manifestPath, `${MANIFEST_NAME}.json`);

    try {
      mkdirSync(config.manifestPath, { recursive: true });
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`Installed native host manifest for ${config.name}: ${manifestPath}`);
    } catch (err) {
      console.error(`Failed to install manifest for ${config.name}:`, err);
    }
  }
}

// Run if called directly
const args = process.argv.slice(2);
if (args.length > 0) {
  // Expect format: --chrome=EXTENSION_ID --brave=EXTENSION_ID --edge=EXTENSION_ID
  const extensionIds: Record<string, string> = {};

  for (const arg of args) {
    const match = arg.match(/^--(\w+)=(.+)$/);
    if (match) {
      extensionIds[match[1]] = match[2];
    }
  }

  if (Object.keys(extensionIds).length === 0) {
    console.log('Usage: bmaestro-install --chrome=EXTENSION_ID --brave=EXTENSION_ID --edge=EXTENSION_ID');
    process.exit(1);
  }

  install(extensionIds);
}

export { install, MANIFEST_NAME };
```

**Step 2: Add bin entry to package.json**

Update `packages/native-host/package.json` bin section:

```json
{
  "bin": {
    "bmaestro-daemon": "./dist/daemon.js",
    "bmaestro-shim": "./dist/shim.js",
    "bmaestro-install": "./dist/install.js"
  }
}
```

**Step 3: Build and verify**

Run: `cd packages/native-host && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/native-host/
git commit -m "feat(native-host): add native host manifest installer"
```

---

## Phase 3: Browser Extension

The browser extension:
- Captures bookmark events via chrome.bookmarks API
- Sends changes to native host via native messaging
- Applies incoming changes from other browsers
- Shows sync status in popup

### Task 3.1: Extension Package Setup

**Files:**
- Create: `packages/extension/package.json`
- Create: `packages/extension/tsconfig.json`
- Create: `packages/extension/manifest.json`

**Step 1: Create package.json**

```json
{
  "name": "@bmaestro/extension",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@bmaestro/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.260",
    "typescript": "^5.3.0",
    "vite": "^5.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "BMaestro Bookmark Sync",
  "version": "1.0.0",
  "description": "Sync bookmarks across Chrome, Brave, and Edge browsers",
  "permissions": [
    "bookmarks",
    "nativeMessaging",
    "storage"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

**Step 4: Create vite.config.ts**

```typescript
// packages/extension/vite.config.ts
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        popup: resolve(__dirname, 'src/popup.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
    },
    target: 'esnext',
    minify: false,
    sourcemap: true,
  },
});
```

**Step 5: Create placeholder files**

```typescript
// packages/extension/src/background.ts
console.log('BMaestro background service worker loaded');
```

```typescript
// packages/extension/src/popup.ts
console.log('BMaestro popup loaded');
```

**Step 6: Install and verify build**

Run: `cd packages/extension && npm install && npm run build`
Expected: Build succeeds, dist/background.js and dist/popup.js created

**Step 7: Commit**

```bash
git add packages/extension/
git commit -m "feat(extension): initialize Manifest V3 extension package"
```

---

### Task 3.2: Bookmark Tree Builder

**Files:**
- Create: `packages/extension/src/bookmarks/tree-builder.ts`
- Create: `packages/extension/src/bookmarks/tree-builder.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/extension/src/bookmarks/tree-builder.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildBookmarkTree, mapChromeBookmark } from './tree-builder.js';
import type { Bookmark } from '@bmaestro/shared/types';

// Mock chrome.bookmarks.getTree
const mockTree: chrome.bookmarks.BookmarkTreeNode[] = [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        parentId: '0',
        title: 'Bookmarks Bar',
        children: [
          {
            id: '100',
            parentId: '1',
            title: 'GitHub',
            url: 'https://github.com',
            dateAdded: 1700000000000,
          },
          {
            id: '101',
            parentId: '1',
            title: 'Dev',
            children: [
              {
                id: '200',
                parentId: '101',
                title: 'MDN',
                url: 'https://developer.mozilla.org',
                dateAdded: 1700000001000,
              },
            ],
          },
        ],
      },
      {
        id: '2',
        parentId: '0',
        title: 'Other Bookmarks',
        children: [],
      },
    ],
  },
];

describe('mapChromeBookmark', () => {
  it('maps a bookmark correctly', () => {
    const chromeBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: '100',
      parentId: '1',
      index: 0,
      title: 'GitHub',
      url: 'https://github.com?utm_source=test',
      dateAdded: 1700000000000,
    };

    const result = mapChromeBookmark(chromeBookmark, 'Bookmarks Bar', null);

    expect(result.nativeId).toBe('100');
    expect(result.parentNativeId).toBe('1');
    expect(result.title).toBe('GitHub');
    expect(result.url).toBe('https://github.com?utm_source=test');
    expect(result.urlNormalized).toBe('https://github.com'); // UTM stripped
    expect(result.isFolder).toBe(false);
    expect(result.path).toBe('Bookmarks Bar');
    expect(result.position).toBe(0);
  });

  it('identifies bookmarks bar folder', () => {
    const chromeBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: '1',
      parentId: '0',
      index: 0,
      title: 'Bookmarks Bar',
      children: [],
    };

    const result = mapChromeBookmark(chromeBookmark, '', 'bookmarks-bar');

    expect(result.isFolder).toBe(true);
    expect(result.folderType).toBe('bookmarks-bar');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/extension && npm test`
Expected: FAIL - vitest not configured

**Step 3: Add vitest to extension**

Update package.json:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^1.0.0"
  }
}
```

**Step 4: Write implementation**

```typescript
// packages/extension/src/bookmarks/tree-builder.ts
import { v7 as uuidv7 } from 'uuid';
import type { Bookmark, FolderType } from '@bmaestro/shared/types';
import { normalizeUrl } from '@bmaestro/shared/utils';
import { calculateChecksum } from '@bmaestro/shared/utils';

/**
 * Map a Chrome bookmark node to our Bookmark type
 */
export function mapChromeBookmark(
  node: chrome.bookmarks.BookmarkTreeNode,
  parentPath: string,
  folderType: FolderType | null,
): Bookmark {
  const isFolder = !node.url;
  const path = parentPath ? `${parentPath}/${node.title}` : node.title;

  const bookmark: Bookmark = {
    id: uuidv7(),
    nativeId: node.id,
    parentNativeId: node.parentId ?? null,
    title: node.title,
    url: node.url ?? null,
    urlNormalized: node.url ? normalizeUrl(node.url) : null,
    isFolder,
    folderType,
    position: node.index ?? 0,
    path: isFolder ? path : parentPath,
    dateAdded: node.dateAdded
      ? new Date(node.dateAdded).toISOString()
      : new Date().toISOString(),
    checksum: '', // Will be set below
  };

  bookmark.checksum = calculateChecksum(bookmark);
  return bookmark;
}

/**
 * Determine folder type for special folders
 */
function getFolderType(node: chrome.bookmarks.BookmarkTreeNode): FolderType | null {
  // Chrome uses specific IDs for special folders
  // ID '1' is bookmarks bar, '2' is other bookmarks
  // But this varies by browser, so we also check title
  const title = node.title.toLowerCase();

  if (node.id === '1' || title === 'bookmarks bar' || title === 'bookmark bar') {
    return 'bookmarks-bar';
  }
  if (node.id === '2' || title === 'other bookmarks') {
    return 'other';
  }
  if (title === 'mobile bookmarks') {
    return 'mobile';
  }
  if (title === 'managed bookmarks') {
    return 'managed';
  }

  return null;
}

/**
 * Recursively build bookmark array from Chrome tree
 */
function walkTree(
  node: chrome.bookmarks.BookmarkTreeNode,
  parentPath: string,
  bookmarks: Bookmark[],
): void {
  // Skip the root node (id: '0')
  if (node.id !== '0') {
    const folderType = node.children ? getFolderType(node) : null;
    const bookmark = mapChromeBookmark(node, parentPath, folderType);
    bookmarks.push(bookmark);
  }

  if (node.children) {
    const newPath = node.id === '0' ? '' : (parentPath ? `${parentPath}/${node.title}` : node.title);
    for (const child of node.children) {
      walkTree(child, newPath, bookmarks);
    }
  }
}

/**
 * Build complete bookmark tree from Chrome API
 */
export async function buildBookmarkTree(): Promise<Bookmark[]> {
  const tree = await chrome.bookmarks.getTree();
  const bookmarks: Bookmark[] = [];

  for (const root of tree) {
    walkTree(root, '', bookmarks);
  }

  return bookmarks;
}

/**
 * Get bookmarks bar contents only
 */
export async function getBookmarksBarContents(): Promise<Bookmark[]> {
  const all = await buildBookmarkTree();
  const bar = all.find(b => b.folderType === 'bookmarks-bar');

  if (!bar) return [];

  return all.filter(b =>
    b.path.startsWith('Bookmarks Bar/') ||
    b.parentNativeId === bar.nativeId
  );
}
```

**Step 5: Install uuid dependency**

Update package.json dependencies:
```json
{
  "dependencies": {
    "@bmaestro/shared": "workspace:*",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@types/uuid": "^9.0.0"
  }
}
```

**Step 6: Run test**

Run: `cd packages/extension && npm install && npm test`
Expected: Tests pass

**Step 7: Commit**

```bash
git add packages/extension/
git commit -m "feat(extension): add bookmark tree builder"
```

---

### Task 3.3: Native Messaging Client

**Files:**
- Create: `packages/extension/src/native/client.ts`

**Step 1: Create implementation**

```typescript
// packages/extension/src/native/client.ts
import type { NativeRequest, NativeResponse, BrowserType } from '@bmaestro/shared/types';
import { ChunkAccumulator, chunkMessage, type MessageChunk, type SingleMessage } from '@bmaestro/shared/protocol';
import { v4 as uuidv4 } from 'uuid';

const NATIVE_HOST_NAME = 'com.bmaestro.native_host';

type ResponseHandler = (response: NativeResponse) => void;
type ErrorHandler = (error: Error) => void;

export class NativeClient {
  private port: chrome.runtime.Port | null = null;
  private pendingRequests = new Map<string, {
    resolve: ResponseHandler;
    reject: ErrorHandler;
    timeout: NodeJS.Timeout;
  }>();
  private chunkAccumulator = new ChunkAccumulator();
  private browserType: BrowserType;
  private onSyncDelta?: (operations: unknown[]) => void;

  constructor(browserType: BrowserType) {
    this.browserType = browserType;
  }

  connect(): void {
    if (this.port) return;

    try {
      this.port = chrome.runtime.connectNative(NATIVE_HOST_NAME);

      this.port.onMessage.addListener((message) => {
        this.handleMessage(message);
      });

      this.port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        console.error('[Native] Disconnected:', error?.message ?? 'Unknown reason');
        this.port = null;

        // Reject all pending requests
        for (const [id, { reject, timeout }] of this.pendingRequests) {
          clearTimeout(timeout);
          reject(new Error('Native host disconnected'));
        }
        this.pendingRequests.clear();
      });

      console.log('[Native] Connected to native host');
    } catch (err) {
      console.error('[Native] Failed to connect:', err);
      throw err;
    }
  }

  disconnect(): void {
    if (this.port) {
      this.port.disconnect();
      this.port = null;
    }
  }

  private handleMessage(message: unknown): void {
    // Check if it's a chunk
    if (typeof message === 'object' && message !== null && 'type' in message) {
      const msg = message as { type: string };

      if (msg.type === 'CHUNK') {
        const chunk = message as MessageChunk;
        const complete = this.chunkAccumulator.addChunk<NativeResponse>(chunk);
        if (complete) {
          this.processResponse(complete);
        }
        return;
      }

      if (msg.type === 'SINGLE') {
        const single = message as SingleMessage<NativeResponse>;
        this.processResponse(single.data);
        return;
      }
    }

    // Treat as direct response
    this.processResponse(message as NativeResponse);
  }

  private processResponse(response: NativeResponse): void {
    // Handle sync delta broadcasts
    if (response.type === 'SYNC_DELTA' && response.payload) {
      if (this.onSyncDelta) {
        this.onSyncDelta((response.payload as { operations?: unknown[] }).operations ?? []);
      }
      return;
    }

    // Handle request responses
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.id);

      if (response.error) {
        pending.reject(new Error(response.error));
      } else {
        pending.resolve(response);
      }
    }
  }

  async send(type: NativeRequest['type'], payload?: Record<string, unknown>): Promise<NativeResponse> {
    if (!this.port) {
      throw new Error('Not connected to native host');
    }

    const request: NativeRequest = {
      id: uuidv4(),
      type,
      payload,
      browser: this.browserType,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error('Request timeout'));
      }, 30000);

      this.pendingRequests.set(request.id, { resolve, reject, timeout });

      // Chunk if necessary
      const chunks = chunkMessage(request);
      for (const chunk of chunks) {
        this.port!.postMessage(chunk);
      }
    });
  }

  onSync(handler: (operations: unknown[]) => void): void {
    this.onSyncDelta = handler;
  }

  async getStatus(): Promise<{ connected: boolean; version: string }> {
    const response = await this.send('GET_STATUS');
    return response.payload as { connected: boolean; version: string };
  }

  async checkInSync(): Promise<void> {
    await this.send('CHECK_IN_SYNC');
  }
}
```

**Step 2: Commit**

```bash
git add packages/extension/src/native/
git commit -m "feat(extension): add native messaging client"
```

---

### Task 3.4: Background Service Worker

**Files:**
- Modify: `packages/extension/src/background.ts`

**Step 1: Implement background service worker**

```typescript
// packages/extension/src/background.ts
import { NativeClient } from './native/client.js';
import { buildBookmarkTree, mapChromeBookmark } from './bookmarks/tree-builder.js';
import type { BrowserType, SyncOperation } from '@bmaestro/shared/types';

// Detect browser type
function detectBrowser(): BrowserType {
  const ua = navigator.userAgent;
  if (ua.includes('Brave')) return 'brave';
  if (ua.includes('Edg/')) return 'edge';
  return 'chrome';
}

const browserType = detectBrowser();
const client = new NativeClient(browserType);

console.log(`[BMaestro] Starting on ${browserType}`);

// Connect to native host
try {
  client.connect();
} catch (err) {
  console.error('[BMaestro] Failed to connect to native host:', err);
}

// Listen for incoming sync deltas
client.onSync((operations) => {
  console.log('[BMaestro] Received sync delta:', operations.length, 'operations');
  applyOperations(operations as SyncOperation[]);
});

// Apply operations from other browsers
async function applyOperations(operations: SyncOperation[]): Promise<void> {
  for (const op of operations) {
    try {
      switch (op.opType) {
        case 'ADD':
          await applyAdd(op);
          break;
        case 'UPDATE':
          await applyUpdate(op);
          break;
        case 'DELETE':
          await applyDelete(op);
          break;
        case 'MOVE':
          await applyMove(op);
          break;
      }
    } catch (err) {
      console.error('[BMaestro] Failed to apply operation:', op.id, err);
    }
  }
}

async function applyAdd(op: SyncOperation): Promise<void> {
  const payload = op.payload as {
    parentNativeId: string;
    title: string;
    url?: string;
    index?: number;
  };

  await chrome.bookmarks.create({
    parentId: payload.parentNativeId,
    title: payload.title,
    url: payload.url,
    index: payload.index,
  });
}

async function applyUpdate(op: SyncOperation): Promise<void> {
  const payload = op.payload as {
    nativeId: string;
    title?: string;
    url?: string;
  };

  await chrome.bookmarks.update(payload.nativeId, {
    title: payload.title,
    url: payload.url,
  });
}

async function applyDelete(op: SyncOperation): Promise<void> {
  const payload = op.payload as { nativeId: string };

  try {
    await chrome.bookmarks.remove(payload.nativeId);
  } catch {
    // Try removing as tree (folder)
    await chrome.bookmarks.removeTree(payload.nativeId);
  }
}

async function applyMove(op: SyncOperation): Promise<void> {
  const payload = op.payload as {
    nativeId: string;
    parentNativeId: string;
    index?: number;
  };

  await chrome.bookmarks.move(payload.nativeId, {
    parentId: payload.parentNativeId,
    index: payload.index,
  });
}

// Listen for bookmark changes
let ignoreNextChange = false;

chrome.bookmarks.onCreated.addListener(async (id, bookmark) => {
  if (ignoreNextChange) {
    ignoreNextChange = false;
    return;
  }

  console.log('[BMaestro] Bookmark created:', id);

  try {
    await client.send('BOOKMARK_ADDED', {
      nativeId: id,
      parentNativeId: bookmark.parentId,
      title: bookmark.title,
      url: bookmark.url,
      index: bookmark.index,
    });
  } catch (err) {
    console.error('[BMaestro] Failed to sync created bookmark:', err);
  }
});

chrome.bookmarks.onChanged.addListener(async (id, changes) => {
  if (ignoreNextChange) {
    ignoreNextChange = false;
    return;
  }

  console.log('[BMaestro] Bookmark changed:', id);

  try {
    await client.send('BOOKMARK_UPDATED', {
      nativeId: id,
      title: changes.title,
      url: changes.url,
    });
  } catch (err) {
    console.error('[BMaestro] Failed to sync changed bookmark:', err);
  }
});

chrome.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
  if (ignoreNextChange) {
    ignoreNextChange = false;
    return;
  }

  console.log('[BMaestro] Bookmark removed:', id);

  try {
    await client.send('BOOKMARK_DELETED', {
      nativeId: id,
      parentNativeId: removeInfo.parentId,
    });
  } catch (err) {
    console.error('[BMaestro] Failed to sync removed bookmark:', err);
  }
});

chrome.bookmarks.onMoved.addListener(async (id, moveInfo) => {
  if (ignoreNextChange) {
    ignoreNextChange = false;
    return;
  }

  console.log('[BMaestro] Bookmark moved:', id);

  try {
    await client.send('BOOKMARK_MOVED', {
      nativeId: id,
      oldParentNativeId: moveInfo.oldParentId,
      newParentNativeId: moveInfo.parentId,
      oldIndex: moveInfo.oldIndex,
      newIndex: moveInfo.index,
    });
  } catch (err) {
    console.error('[BMaestro] Failed to sync moved bookmark:', err);
  }
});

// Check in periodically
setInterval(() => {
  client.checkInSync().catch((err) => {
    console.error('[BMaestro] Check-in failed:', err);
  });
}, 60000); // Every minute

// Export for popup access
(globalThis as any).bmaestroClient = client;
(globalThis as any).bmaestroGetTree = buildBookmarkTree;
```

**Step 2: Build and verify**

Run: `cd packages/extension && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/extension/src/background.ts
git commit -m "feat(extension): implement background service worker with bookmark sync"
```

---

### Task 3.5: Popup UI

**Files:**
- Create: `packages/extension/popup.html`
- Modify: `packages/extension/src/popup.ts`
- Create: `packages/extension/src/popup.css`

**Step 1: Create popup.html**

```html
<!-- packages/extension/popup.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>BMaestro</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="container">
    <h1>BMaestro</h1>
    <div id="status" class="status">
      <span class="indicator" id="indicator"></span>
      <span id="statusText">Checking...</span>
    </div>
    <div class="stats">
      <div class="stat">
        <span class="label">Bookmarks</span>
        <span class="value" id="bookmarkCount">-</span>
      </div>
      <div class="stat">
        <span class="label">Last Sync</span>
        <span class="value" id="lastSync">Never</span>
      </div>
    </div>
    <div class="actions">
      <button id="syncNow">Sync Now</button>
      <button id="openDashboard">Dashboard</button>
    </div>
  </div>
  <script src="popup.js" type="module"></script>
</body>
</html>
```

**Step 2: Create popup.css**

```css
/* packages/extension/src/popup.css */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  width: 280px;
  padding: 16px;
  background: #fff;
}

.container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

h1 {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}

.status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 8px;
}

.indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ccc;
}

.indicator.connected {
  background: #22c55e;
}

.indicator.disconnected {
  background: #ef4444;
}

.indicator.syncing {
  background: #f59e0b;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

#statusText {
  font-size: 14px;
  color: #666;
}

.stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.stat {
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 8px;
}

.stat .label {
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat .value {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
  margin-top: 4px;
}

.actions {
  display: flex;
  gap: 8px;
}

button {
  flex: 1;
  padding: 10px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

#syncNow {
  background: #3b82f6;
  color: white;
}

#syncNow:hover {
  background: #2563eb;
}

#openDashboard {
  background: #e5e5e5;
  color: #1a1a1a;
}

#openDashboard:hover {
  background: #d4d4d4;
}
```

**Step 3: Implement popup.ts**

```typescript
// packages/extension/src/popup.ts

async function init() {
  const indicator = document.getElementById('indicator')!;
  const statusText = document.getElementById('statusText')!;
  const bookmarkCount = document.getElementById('bookmarkCount')!;
  const lastSync = document.getElementById('lastSync')!;
  const syncNowBtn = document.getElementById('syncNow')!;
  const openDashboardBtn = document.getElementById('openDashboard')!;

  // Get background page references
  const bg = await chrome.runtime.getBackgroundPage();
  const client = (bg as any)?.bmaestroClient;
  const getTree = (bg as any)?.bmaestroGetTree;

  // Update status
  async function updateStatus() {
    try {
      if (client) {
        const status = await client.getStatus();
        indicator.className = `indicator ${status.connected ? 'connected' : 'disconnected'}`;
        statusText.textContent = status.connected ? 'Connected' : 'Offline';
      } else {
        indicator.className = 'indicator disconnected';
        statusText.textContent = 'Not initialized';
      }
    } catch {
      indicator.className = 'indicator disconnected';
      statusText.textContent = 'Error';
    }
  }

  // Update bookmark count
  async function updateBookmarkCount() {
    try {
      const tree = await chrome.bookmarks.getTree();
      let count = 0;

      function countBookmarks(nodes: chrome.bookmarks.BookmarkTreeNode[]) {
        for (const node of nodes) {
          if (node.url) count++;
          if (node.children) countBookmarks(node.children);
        }
      }

      countBookmarks(tree);
      bookmarkCount.textContent = count.toString();
    } catch {
      bookmarkCount.textContent = '-';
    }
  }

  // Get last sync time
  async function updateLastSync() {
    const { lastSyncTime } = await chrome.storage.local.get('lastSyncTime');
    if (lastSyncTime) {
      const date = new Date(lastSyncTime);
      const now = new Date();
      const diff = now.getTime() - date.getTime();

      if (diff < 60000) {
        lastSync.textContent = 'Just now';
      } else if (diff < 3600000) {
        const mins = Math.floor(diff / 60000);
        lastSync.textContent = `${mins}m ago`;
      } else if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        lastSync.textContent = `${hours}h ago`;
      } else {
        lastSync.textContent = date.toLocaleDateString();
      }
    } else {
      lastSync.textContent = 'Never';
    }
  }

  // Sync now button
  syncNowBtn.addEventListener('click', async () => {
    if (!client) return;

    indicator.className = 'indicator syncing';
    statusText.textContent = 'Syncing...';

    try {
      await client.checkInSync();
      await chrome.storage.local.set({ lastSyncTime: Date.now() });
      await updateLastSync();
      indicator.className = 'indicator connected';
      statusText.textContent = 'Connected';
    } catch (err) {
      indicator.className = 'indicator disconnected';
      statusText.textContent = 'Sync failed';
    }
  });

  // Dashboard button
  openDashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://bmaestro-dashboard.fly.dev' });
  });

  // Initial update
  await Promise.all([
    updateStatus(),
    updateBookmarkCount(),
    updateLastSync(),
  ]);
}

init().catch(console.error);
```

**Step 4: Update vite config to copy static files**

```typescript
// packages/extension/vite.config.ts
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        popup: resolve(__dirname, 'src/popup.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
    },
    target: 'esnext',
    minify: false,
    sourcemap: true,
  },
  plugins: [
    {
      name: 'copy-extension-files',
      closeBundle() {
        // Copy manifest and static files
        copyFileSync('manifest.json', 'dist/manifest.json');
        copyFileSync('popup.html', 'dist/popup.html');
        copyFileSync('src/popup.css', 'dist/popup.css');

        // Create icons directory
        mkdirSync('dist/icons', { recursive: true });
      },
    },
  ],
});
```

**Step 5: Build and verify**

Run: `cd packages/extension && npm run build`
Expected: Build succeeds, dist folder contains all files

**Step 6: Commit**

```bash
git add packages/extension/
git commit -m "feat(extension): add popup UI with sync status"
```

---

## Phase 4: Dashboard (SvelteKit)

The dashboard provides:
- Overview of connected browsers
- Sync status and history
- Conflict resolution UI
- Manual bookmark management

### Task 4.1: Dashboard Package Setup

**Files:**
- Create: `packages/dashboard/package.json`
- Create: `packages/dashboard/svelte.config.js`
- Create: `packages/dashboard/vite.config.ts`
- Create: `packages/dashboard/src/app.html`
- Create: `packages/dashboard/src/routes/+page.svelte`

**Step 1: Create package.json**

```json
{
  "name": "@bmaestro/dashboard",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"
  },
  "dependencies": {
    "@bmaestro/shared": "workspace:*",
    "pocketbase": "^0.21.0"
  },
  "devDependencies": {
    "@sveltejs/adapter-auto": "^3.0.0",
    "@sveltejs/kit": "^2.0.0",
    "@sveltejs/vite-plugin-svelte": "^3.0.0",
    "svelte": "^4.2.0",
    "svelte-check": "^3.6.0",
    "tslib": "^2.6.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0"
  }
}
```

**Step 2: Create svelte.config.js**

```javascript
// packages/dashboard/svelte.config.js
import adapter from '@sveltejs/adapter-auto';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
  },
};

export default config;
```

**Step 3: Create vite.config.ts**

```typescript
// packages/dashboard/vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
});
```

**Step 4: Create app.html**

```html
<!-- packages/dashboard/src/app.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%sveltekit.assets%/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

**Step 5: Create +page.svelte**

```svelte
<!-- packages/dashboard/src/routes/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';

  let browsers: Array<{
    id: string;
    name: string;
    isConnected: boolean;
    isCanonical: boolean;
    lastSync: string | null;
    bookmarkCount: number;
  }> = [];

  let loading = true;
  let error: string | null = null;

  onMount(async () => {
    try {
      // TODO: Fetch from PocketBase
      browsers = [
        {
          id: '1',
          name: 'chrome',
          isConnected: true,
          isCanonical: true,
          lastSync: new Date().toISOString(),
          bookmarkCount: 142,
        },
        {
          id: '2',
          name: 'brave',
          isConnected: true,
          isCanonical: false,
          lastSync: new Date().toISOString(),
          bookmarkCount: 138,
        },
        {
          id: '3',
          name: 'edge',
          isConnected: false,
          isCanonical: false,
          lastSync: null,
          bookmarkCount: 0,
        },
      ];
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>BMaestro Dashboard</title>
</svelte:head>

<main>
  <header>
    <h1>BMaestro</h1>
    <p>Cross-Browser Bookmark Sync</p>
  </header>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else}
    <section class="browsers">
      <h2>Connected Browsers</h2>
      <div class="browser-grid">
        {#each browsers as browser}
          <div class="browser-card" class:connected={browser.isConnected} class:canonical={browser.isCanonical}>
            <div class="browser-header">
              <span class="browser-icon">{browser.name === 'chrome' ? '🔵' : browser.name === 'brave' ? '🦁' : '🌐'}</span>
              <span class="browser-name">{browser.name}</span>
              {#if browser.isCanonical}
                <span class="canonical-badge">Canonical</span>
              {/if}
            </div>
            <div class="browser-stats">
              <div class="stat">
                <span class="stat-value">{browser.bookmarkCount}</span>
                <span class="stat-label">Bookmarks</span>
              </div>
              <div class="stat">
                <span class="stat-value">{browser.isConnected ? '✓' : '✗'}</span>
                <span class="stat-label">Status</span>
              </div>
            </div>
            <div class="browser-footer">
              {#if browser.lastSync}
                Last sync: {new Date(browser.lastSync).toLocaleString()}
              {:else}
                Never synced
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </section>

    <section class="actions">
      <button class="primary">Sync All</button>
      <button>View Conflicts</button>
      <button>Export Bookmarks</button>
    </section>
  {/if}
</main>

<style>
  :global(body) {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    margin: 0;
    padding: 0;
    background: #f5f5f5;
    color: #1a1a1a;
  }

  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
  }

  header {
    margin-bottom: 2rem;
  }

  h1 {
    font-size: 2rem;
    margin: 0;
  }

  header p {
    color: #666;
    margin: 0.5rem 0 0;
  }

  h2 {
    font-size: 1.25rem;
    margin: 0 0 1rem;
  }

  .browser-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
  }

  .browser-card {
    background: white;
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    border: 2px solid transparent;
  }

  .browser-card.connected {
    border-color: #22c55e;
  }

  .browser-card.canonical {
    border-color: #3b82f6;
  }

  .browser-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .browser-icon {
    font-size: 1.5rem;
  }

  .browser-name {
    font-weight: 600;
    text-transform: capitalize;
  }

  .canonical-badge {
    margin-left: auto;
    background: #3b82f6;
    color: white;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .browser-stats {
    display: flex;
    gap: 2rem;
    margin-bottom: 1rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
  }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 600;
  }

  .stat-label {
    font-size: 0.75rem;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .browser-footer {
    font-size: 0.875rem;
    color: #666;
  }

  .actions {
    margin-top: 2rem;
    display: flex;
    gap: 1rem;
  }

  button {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    background: #e5e5e5;
    color: #1a1a1a;
    transition: background 0.2s;
  }

  button:hover {
    background: #d4d4d4;
  }

  button.primary {
    background: #3b82f6;
    color: white;
  }

  button.primary:hover {
    background: #2563eb;
  }

  .loading, .error {
    padding: 2rem;
    text-align: center;
  }

  .error {
    color: #ef4444;
  }
</style>
```

**Step 6: Create tsconfig.json**

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

**Step 7: Install and verify**

Run: `cd packages/dashboard && npm install && npm run build`
Expected: Build succeeds

**Step 8: Commit**

```bash
git add packages/dashboard/
git commit -m "feat(dashboard): initialize SvelteKit dashboard"
```

---

## Phase 5: Integration and Testing

### Task 5.1: Root Package Scripts

**Files:**
- Modify: `package.json` (root)

**Step 1: Update root package.json**

```json
{
  "name": "bmaestro",
  "version": "1.0.0",
  "private": true,
  "description": "Cross-browser bookmark sync with cloud backend",
  "type": "module",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "build:shared": "npm run build -w packages/shared",
    "build:sync-service": "npm run build -w packages/sync-service",
    "build:native-host": "npm run build -w packages/native-host",
    "build:extension": "npm run build -w packages/extension",
    "build:dashboard": "npm run build -w packages/dashboard",
    "test": "npm run test --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "dev:sync-service": "npm run dev -w packages/sync-service",
    "dev:dashboard": "npm run dev -w packages/dashboard",
    "deploy:pocketbase": "cd packages/pocketbase && fly deploy",
    "deploy:sync-service": "cd packages/sync-service && fly deploy"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/jaslr/bmaestro.git"
  },
  "author": "jaslr",
  "license": "MIT",
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "chore: add convenience scripts to root package.json"
```

---

### Task 5.2: End-to-End Verification

**Step 1: Clean install and build all**

```bash
rm -rf node_modules packages/*/node_modules
npm install
npm run build
```

Expected: All packages build successfully

**Step 2: Run all tests**

```bash
npm run test
```

Expected: All tests pass

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: verify full build and tests pass"
```

---

## Deployment Checklist

After completing all tasks, deploy in this order:

1. **Deploy PocketBase** (already configured)
   ```bash
   npm run deploy:pocketbase
   ```

2. **Deploy Sync Service**
   ```bash
   npm run deploy:sync-service
   ```

3. **Load Extension in browsers**
   - Chrome: chrome://extensions → Load unpacked → packages/extension/dist
   - Brave: brave://extensions → Load unpacked → packages/extension/dist
   - Edge: edge://extensions → Load unpacked → packages/extension/dist

4. **Install Native Host**
   ```bash
   cd packages/native-host
   npm run build
   node dist/install.js --chrome=EXTENSION_ID --brave=EXTENSION_ID --edge=EXTENSION_ID
   ```

5. **Start Native Host Daemon**
   ```bash
   node packages/native-host/dist/daemon.js
   ```

6. **Deploy Dashboard** (optional - configure fly.toml first)
   ```bash
   cd packages/dashboard
   fly deploy
   ```

---

## Summary

This plan implements BMaestro in 5 phases with 20+ bite-sized tasks. Each task follows TDD with explicit test-first development.

**Phase 1**: Sync Service - WebSocket server for cloud sync
**Phase 2**: Native Host - Local daemon and browser shim
**Phase 3**: Extension - Manifest V3 with bookmark sync
**Phase 4**: Dashboard - SvelteKit monitoring UI
**Phase 5**: Integration - End-to-end testing and deployment

Total estimated implementation: Follow tasks sequentially, committing after each.
