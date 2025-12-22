# BMaestro Daemon Removal - Direct Cloud Sync

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the local daemon/native-host and have extensions connect directly to the cloud sync service with poll-based sync and manual controls.

**Architecture Change:**
```
BEFORE:                                    AFTER:
Extension → Native Host → Daemon → Cloud   Extension → Cloud (direct WebSocket/HTTP)
```

**Tech Stack:** Chrome Extension (Manifest V3), WebSocket, chrome.alarms, PocketBase

---

## Phase 1: PocketBase Activity Log Schema

### Task 1.1: Add activity_log collection migration

**Files:**
- Create: `packages/pocketbase/pb_migrations/1734800010_activity_log.js`

**Step 1: Write the migration file**

```javascript
// packages/pocketbase/pb_migrations/1734800010_activity_log.js
migrate((db) => {
  const collection = new Collection({
    id: "activity_log",
    name: "activity_log",
    type: "base",
    system: false,
    schema: [
      {
        name: "user_id",
        type: "relation",
        required: true,
        options: {
          collectionId: "_pb_users_auth_",
          cascadeDelete: false,
          maxSelect: 1,
        },
      },
      {
        name: "device_id",
        type: "text",
        required: true,
      },
      {
        name: "browser_type",
        type: "select",
        required: true,
        options: {
          values: ["chrome", "brave", "edge"],
        },
      },
      {
        name: "action",
        type: "select",
        required: true,
        options: {
          values: [
            "BOOKMARK_ADDED",
            "BOOKMARK_UPDATED",
            "BOOKMARK_DELETED",
            "BOOKMARK_MOVED",
            "SYNC_STARTED",
            "SYNC_COMPLETED",
            "SYNC_FAILED",
            "CONFLICT_DETECTED",
            "CONFLICT_RESOLVED",
            "DEVICE_CONNECTED",
            "DEVICE_DISCONNECTED",
          ],
        },
      },
      {
        name: "bookmark_title",
        type: "text",
        required: false,
      },
      {
        name: "bookmark_url",
        type: "url",
        required: false,
      },
      {
        name: "details",
        type: "json",
        required: false,
      },
      {
        name: "timestamp",
        type: "date",
        required: true,
      },
    ],
    indexes: [
      "CREATE INDEX idx_activity_user ON activity_log (user_id)",
      "CREATE INDEX idx_activity_timestamp ON activity_log (timestamp DESC)",
      "CREATE INDEX idx_activity_action ON activity_log (action)",
      "CREATE INDEX idx_activity_browser ON activity_log (browser_type)",
      "CREATE INDEX idx_activity_device ON activity_log (device_id)",
    ],
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("activity_log");
  return dao.deleteCollection(collection);
});
```

**Step 2: Verify migration syntax**

Run: `cd /home/chip/bmaestro/packages/pocketbase && cat pb_migrations/1734800010_activity_log.js`

**Step 3: Commit**

```bash
git add packages/pocketbase/pb_migrations/1734800010_activity_log.js
git commit -m "feat(pocketbase): add activity_log collection for audit trail"
```

---

## Phase 2: Sync Service Updates

### Task 2.1: Add HTTP endpoints for pull-based sync

**Files:**
- Modify: `packages/sync-service/src/index.ts`
- Create: `packages/sync-service/src/http/routes.ts`
- Create: `packages/sync-service/src/http/activity-logger.ts`

**Step 1: Create activity logger utility**

```typescript
// packages/sync-service/src/http/activity-logger.ts
import PocketBase from 'pocketbase';

const pb = new PocketBase(process.env.POCKETBASE_URL || 'https://bmaestro-pocketbase.fly.dev');

export interface ActivityLogEntry {
  user_id: string;
  device_id: string;
  browser_type: 'chrome' | 'brave' | 'edge';
  action: string;
  bookmark_title?: string;
  bookmark_url?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export async function logActivity(entry: ActivityLogEntry): Promise<void> {
  try {
    await pb.collection('activity_log').create(entry);
  } catch (err) {
    console.error('[ActivityLog] Failed to log activity:', err);
  }
}

export async function getActivityLog(
  userId: string,
  options?: {
    limit?: number;
    offset?: number;
    action?: string;
    browserType?: string;
    startDate?: string;
    endDate?: string;
  }
): Promise<{ items: ActivityLogEntry[]; totalItems: number }> {
  const filter: string[] = [`user_id = "${userId}"`];

  if (options?.action) {
    filter.push(`action = "${options.action}"`);
  }
  if (options?.browserType) {
    filter.push(`browser_type = "${options.browserType}"`);
  }
  if (options?.startDate) {
    filter.push(`timestamp >= "${options.startDate}"`);
  }
  if (options?.endDate) {
    filter.push(`timestamp <= "${options.endDate}"`);
  }

  const result = await pb.collection('activity_log').getList(
    Math.floor((options?.offset || 0) / (options?.limit || 50)) + 1,
    options?.limit || 50,
    {
      filter: filter.join(' && '),
      sort: '-timestamp',
    }
  );

  return {
    items: result.items as unknown as ActivityLogEntry[],
    totalItems: result.totalItems,
  };
}
```

**Step 2: Create HTTP routes**

```typescript
// packages/sync-service/src/http/routes.ts
import { IncomingMessage, ServerResponse } from 'http';
import { logActivity, getActivityLog } from './activity-logger.js';

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, data: any, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function verifyAuth(req: IncomingMessage): string | null {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return 'anonymous';

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ') && authHeader.slice(7) === secret) {
    return req.headers['x-user-id'] as string || 'anonymous';
  }
  return null;
}

export async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  // CORS headers for extension
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Id, X-Device-Id, X-Browser-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  // Health check (no auth)
  if (path === '/health') {
    json(res, { status: 'ok', timestamp: new Date().toISOString() });
    return true;
  }

  // All other routes require auth
  const userId = verifyAuth(req);
  if (!userId) {
    json(res, { error: 'Unauthorized' }, 401);
    return true;
  }

  // POST /sync - Push changes and get delta
  if (path === '/sync' && method === 'POST') {
    const body = await parseBody(req);
    const deviceId = req.headers['x-device-id'] as string;
    const browserType = req.headers['x-browser-type'] as string;

    // Log sync start
    await logActivity({
      user_id: userId,
      device_id: deviceId,
      browser_type: browserType as any,
      action: 'SYNC_STARTED',
      timestamp: new Date().toISOString(),
    });

    // TODO: Process incoming operations, return delta
    // This will be implemented in Task 2.2

    json(res, {
      success: true,
      operations: [],
      lastSyncVersion: Date.now(),
    });
    return true;
  }

  // GET /activity - Get activity log
  if (path === '/activity' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const action = url.searchParams.get('action') || undefined;
    const browserType = url.searchParams.get('browser') || undefined;
    const startDate = url.searchParams.get('start') || undefined;
    const endDate = url.searchParams.get('end') || undefined;

    const result = await getActivityLog(userId, {
      limit,
      offset,
      action,
      browserType,
      startDate,
      endDate,
    });

    json(res, result);
    return true;
  }

  return false; // Not handled, let WebSocket handle
}
```

**Step 3: Update main server to use HTTP routes**

Add to `packages/sync-service/src/index.ts` after line 8:

```typescript
import { handleHttpRequest } from './http/routes.js';
```

Replace the request handler (around line 14-25) with:

```typescript
const server = createServer(async (req, res) => {
  // Try HTTP routes first
  const handled = await handleHttpRequest(req, res);
  if (handled) return;

  // Health check fallback
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
    }));
  }
});
```

**Step 4: Install PocketBase SDK**

Run: `cd /home/chip/bmaestro/packages/sync-service && npm install pocketbase`

**Step 5: Build and test**

Run: `cd /home/chip/bmaestro/packages/sync-service && npm run build`

**Step 6: Commit**

```bash
git add packages/sync-service/src/http/
git add packages/sync-service/src/index.ts
git add packages/sync-service/package.json packages/sync-service/package-lock.json
git commit -m "feat(sync-service): add HTTP endpoints for direct extension sync"
```

---

### Task 2.2: Implement sync operation processing

**Files:**
- Create: `packages/sync-service/src/sync/processor.ts`
- Modify: `packages/sync-service/src/http/routes.ts`

**Step 1: Create sync processor**

```typescript
// packages/sync-service/src/sync/processor.ts
import PocketBase from 'pocketbase';
import type { SyncOperation } from '@bmaestro/shared/types';
import { logActivity } from '../http/activity-logger.js';

const pb = new PocketBase(process.env.POCKETBASE_URL || 'https://bmaestro-pocketbase.fly.dev');

export interface SyncRequest {
  userId: string;
  deviceId: string;
  browserType: 'chrome' | 'brave' | 'edge';
  operations: SyncOperation[];
  lastSyncVersion: number;
}

export interface SyncResponse {
  success: boolean;
  operations: SyncOperation[];
  lastSyncVersion: number;
  conflicts?: Array<{
    localOp: SyncOperation;
    remoteOp: SyncOperation;
    resolution: 'local_wins' | 'remote_wins';
  }>;
}

export async function processSyncRequest(req: SyncRequest): Promise<SyncResponse> {
  const { userId, deviceId, browserType, operations, lastSyncVersion } = req;

  // 1. Get operations from other devices since lastSyncVersion
  const pendingOps = await pb.collection('sync_operations').getFullList({
    filter: `user_id = "${userId}" && device_id != "${deviceId}" && version > ${lastSyncVersion}`,
    sort: 'version',
  });

  // 2. Process incoming operations with last-edit-wins conflict resolution
  const conflicts: SyncResponse['conflicts'] = [];
  const newVersion = Date.now();

  for (const op of operations) {
    // Check for conflicts (same bookmark modified by different devices)
    const conflictingOp = pendingOps.find(
      pending => {
        const pendingPayload = pending.payload as any;
        const opPayload = op.payload as any;
        return pendingPayload?.nativeId === opPayload?.nativeId ||
               pendingPayload?.url === opPayload?.url;
      }
    );

    if (conflictingOp) {
      // Last edit wins
      const conflictOpTimestamp = new Date(conflictingOp.timestamp).getTime();
      const localOpTimestamp = new Date(op.timestamp).getTime();

      conflicts.push({
        localOp: op,
        remoteOp: conflictingOp as unknown as SyncOperation,
        resolution: localOpTimestamp > conflictOpTimestamp ? 'local_wins' : 'remote_wins',
      });

      // Log conflict
      await logActivity({
        user_id: userId,
        device_id: deviceId,
        browser_type: browserType,
        action: 'CONFLICT_RESOLVED',
        bookmark_title: (op.payload as any)?.title,
        bookmark_url: (op.payload as any)?.url,
        details: {
          resolution: localOpTimestamp > conflictOpTimestamp ? 'local_wins' : 'remote_wins',
          localTimestamp: op.timestamp,
          remoteTimestamp: conflictingOp.timestamp,
        },
        timestamp: new Date().toISOString(),
      });

      // If remote wins, skip saving local op
      if (conflictOpTimestamp > localOpTimestamp) {
        continue;
      }
    }

    // Save operation to database
    await pb.collection('sync_operations').create({
      user_id: userId,
      device_id: deviceId,
      op_type: op.opType,
      bookmark_id: op.bookmarkId,
      payload: op.payload,
      version: newVersion,
      timestamp: op.timestamp || new Date().toISOString(),
    });

    // Log activity
    const actionMap: Record<string, string> = {
      'ADD': 'BOOKMARK_ADDED',
      'UPDATE': 'BOOKMARK_UPDATED',
      'DELETE': 'BOOKMARK_DELETED',
      'MOVE': 'BOOKMARK_MOVED',
    };

    await logActivity({
      user_id: userId,
      device_id: deviceId,
      browser_type: browserType,
      action: actionMap[op.opType] || 'BOOKMARK_UPDATED',
      bookmark_title: (op.payload as any)?.title,
      bookmark_url: (op.payload as any)?.url,
      details: op.payload as Record<string, unknown>,
      timestamp: new Date().toISOString(),
    });
  }

  // 3. Return operations to apply (from other devices)
  const opsToApply = pendingOps
    .filter(op => {
      // Exclude ops that lost conflict resolution
      const lostConflict = conflicts.find(
        c => c.remoteOp.id === op.id && c.resolution === 'local_wins'
      );
      return !lostConflict;
    })
    .map(op => ({
      id: op.id,
      opType: op.op_type,
      bookmarkId: op.bookmark_id,
      payload: op.payload,
      timestamp: op.timestamp,
    })) as SyncOperation[];

  // Log sync completed
  await logActivity({
    user_id: userId,
    device_id: deviceId,
    browser_type: browserType,
    action: 'SYNC_COMPLETED',
    details: {
      operationsSent: operations.length,
      operationsReceived: opsToApply.length,
      conflicts: conflicts.length,
    },
    timestamp: new Date().toISOString(),
  });

  return {
    success: true,
    operations: opsToApply,
    lastSyncVersion: newVersion,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
  };
}
```

**Step 2: Update routes to use processor**

Add import to `packages/sync-service/src/http/routes.ts`:

```typescript
import { processSyncRequest } from '../sync/processor.js';
```

Replace the `/sync` handler with:

```typescript
  // POST /sync - Push changes and get delta
  if (path === '/sync' && method === 'POST') {
    const body = await parseBody(req);
    const deviceId = req.headers['x-device-id'] as string;
    const browserType = req.headers['x-browser-type'] as 'chrome' | 'brave' | 'edge';

    if (!deviceId || !browserType) {
      json(res, { error: 'Missing device-id or browser-type header' }, 400);
      return true;
    }

    try {
      const result = await processSyncRequest({
        userId,
        deviceId,
        browserType,
        operations: body.operations || [],
        lastSyncVersion: body.lastSyncVersion || 0,
      });
      json(res, result);
    } catch (err) {
      console.error('[Sync] Error processing sync:', err);
      json(res, { error: 'Sync failed', details: String(err) }, 500);
    }
    return true;
  }
```

**Step 3: Build and test**

Run: `cd /home/chip/bmaestro/packages/sync-service && npm run build`

**Step 4: Commit**

```bash
git add packages/sync-service/src/sync/processor.ts
git add packages/sync-service/src/http/routes.ts
git commit -m "feat(sync-service): implement sync processor with conflict resolution"
```

---

## Phase 3: Extension Direct Cloud Connection

### Task 3.1: Create cloud client to replace NativeClient

**Files:**
- Create: `packages/extension/src/cloud/client.ts`
- Create: `packages/extension/src/cloud/config.ts`

**Step 1: Create config**

```typescript
// packages/extension/src/cloud/config.ts
export const CLOUD_CONFIG = {
  syncUrl: 'https://bmaestro-sync.fly.dev/sync',
  activityUrl: 'https://bmaestro-sync.fly.dev/activity',
  defaultPollIntervalMinutes: 5,
  minPollIntervalMinutes: 1,
  maxPollIntervalMinutes: 60,
};

export interface StoredConfig {
  syncSecret: string;
  userId: string;
  deviceId: string;
  pollIntervalMinutes: number;
  lastSyncVersion: number;
  lastSyncTime: string | null;
}

export async function getConfig(): Promise<StoredConfig> {
  const result = await chrome.storage.local.get([
    'syncSecret',
    'userId',
    'deviceId',
    'pollIntervalMinutes',
    'lastSyncVersion',
    'lastSyncTime',
  ]);

  return {
    syncSecret: result.syncSecret || '',
    userId: result.userId || '',
    deviceId: result.deviceId || `device-${crypto.randomUUID().slice(0, 8)}`,
    pollIntervalMinutes: result.pollIntervalMinutes || CLOUD_CONFIG.defaultPollIntervalMinutes,
    lastSyncVersion: result.lastSyncVersion || 0,
    lastSyncTime: result.lastSyncTime || null,
  };
}

export async function saveConfig(config: Partial<StoredConfig>): Promise<void> {
  await chrome.storage.local.set(config);
}
```

**Step 2: Create cloud client**

```typescript
// packages/extension/src/cloud/client.ts
import { CLOUD_CONFIG, getConfig, saveConfig, type StoredConfig } from './config.js';
import type { SyncOperation, BrowserType } from '@bmaestro/shared/types';

export interface SyncResult {
  success: boolean;
  operations: SyncOperation[];
  lastSyncVersion: number;
  conflicts?: Array<{
    localOp: SyncOperation;
    remoteOp: SyncOperation;
    resolution: 'local_wins' | 'remote_wins';
  }>;
  error?: string;
}

export class CloudClient {
  private browserType: BrowserType;
  private config: StoredConfig | null = null;
  private pendingOperations: SyncOperation[] = [];
  private syncInProgress = false;
  private syncHandlers: Array<(ops: SyncOperation[]) => void> = [];

  constructor(browserType: BrowserType) {
    this.browserType = browserType;
  }

  async initialize(): Promise<void> {
    this.config = await getConfig();

    // Generate device ID if not set
    if (!this.config.deviceId) {
      this.config.deviceId = `device-${crypto.randomUUID().slice(0, 8)}`;
      await saveConfig({ deviceId: this.config.deviceId });
    }
  }

  isConfigured(): boolean {
    return !!(this.config?.syncSecret && this.config?.userId);
  }

  getStatus(): { configured: boolean; lastSync: string | null; pendingOps: number } {
    return {
      configured: this.isConfigured(),
      lastSync: this.config?.lastSyncTime || null,
      pendingOps: this.pendingOperations.length,
    };
  }

  // Queue an operation for next sync
  queueOperation(op: SyncOperation): void {
    this.pendingOperations.push(op);
    console.log('[Cloud] Queued operation:', op.opType, 'pending:', this.pendingOperations.length);
  }

  // Register handler for incoming sync operations
  onSync(handler: (ops: SyncOperation[]) => void): void {
    this.syncHandlers.push(handler);
  }

  // Perform sync with cloud
  async sync(): Promise<SyncResult> {
    if (!this.config) {
      await this.initialize();
    }

    if (!this.isConfigured()) {
      return {
        success: false,
        operations: [],
        lastSyncVersion: 0,
        error: 'Not configured. Set syncSecret and userId in extension options.',
      };
    }

    if (this.syncInProgress) {
      return {
        success: false,
        operations: [],
        lastSyncVersion: this.config!.lastSyncVersion,
        error: 'Sync already in progress',
      };
    }

    this.syncInProgress = true;
    console.log('[Cloud] Starting sync, pending ops:', this.pendingOperations.length);

    try {
      const response = await fetch(CLOUD_CONFIG.syncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config!.syncSecret}`,
          'X-User-Id': this.config!.userId,
          'X-Device-Id': this.config!.deviceId,
          'X-Browser-Type': this.browserType,
        },
        body: JSON.stringify({
          operations: this.pendingOperations,
          lastSyncVersion: this.config!.lastSyncVersion,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sync failed: ${response.status} ${errorText}`);
      }

      const result: SyncResult = await response.json();

      // Clear pending operations that were sent
      this.pendingOperations = [];

      // Update stored config
      await saveConfig({
        lastSyncVersion: result.lastSyncVersion,
        lastSyncTime: new Date().toISOString(),
      });
      this.config!.lastSyncVersion = result.lastSyncVersion;
      this.config!.lastSyncTime = new Date().toISOString();

      // Notify handlers of incoming operations
      if (result.operations.length > 0) {
        console.log('[Cloud] Received', result.operations.length, 'operations to apply');
        for (const handler of this.syncHandlers) {
          handler(result.operations);
        }
      }

      console.log('[Cloud] Sync complete');
      return result;

    } catch (err) {
      console.error('[Cloud] Sync error:', err);
      return {
        success: false,
        operations: [],
        lastSyncVersion: this.config!.lastSyncVersion,
        error: String(err),
      };
    } finally {
      this.syncInProgress = false;
    }
  }

  // Get poll interval
  async getPollInterval(): Promise<number> {
    if (!this.config) await this.initialize();
    return this.config!.pollIntervalMinutes;
  }

  // Set poll interval
  async setPollInterval(minutes: number): Promise<void> {
    const clamped = Math.max(
      CLOUD_CONFIG.minPollIntervalMinutes,
      Math.min(CLOUD_CONFIG.maxPollIntervalMinutes, minutes)
    );
    await saveConfig({ pollIntervalMinutes: clamped });
    if (this.config) this.config.pollIntervalMinutes = clamped;
  }
}
```

**Step 3: Commit**

```bash
git add packages/extension/src/cloud/
git commit -m "feat(extension): add CloudClient for direct cloud sync"
```

---

### Task 3.2: Update background.ts to use CloudClient with alarms

**Files:**
- Modify: `packages/extension/src/background.ts`

**Step 1: Replace entire background.ts**

```typescript
// packages/extension/src/background.ts
// Must be first import - sets up browser shims for Node.js globals
import './shim.js';

import { CloudClient } from './cloud/client.js';
import { buildBookmarkTree } from './bookmarks/tree-builder.js';
import type { BrowserType, SyncOperation } from '@bmaestro/shared/types';

// Detect browser type
function detectBrowser(): BrowserType {
  const ua = navigator.userAgent;
  if (ua.includes('Brave')) return 'brave';
  if (ua.includes('Edg/')) return 'edge';
  return 'chrome';
}

const browserType = detectBrowser();
const client = new CloudClient(browserType);

// Constants
const ALARM_NAME = 'bmaestro-sync';
const DEDUPE_TIMEOUT_MS = 2000;

// Track recently synced IDs to prevent infinite loops
const recentlySyncedIds = new Set<string>();

console.log(`[BMaestro] Starting on ${browserType}`);

// Initialize client
client.initialize().then(() => {
  console.log('[BMaestro] CloudClient initialized');
  setupAlarm();
});

// Set up periodic sync alarm
async function setupAlarm(): Promise<void> {
  const intervalMinutes = await client.getPollInterval();

  // Clear existing alarm
  await chrome.alarms.clear(ALARM_NAME);

  // Create new alarm
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 0.1, // Initial sync after 6 seconds
    periodInMinutes: intervalMinutes,
  });

  console.log(`[BMaestro] Sync alarm set for every ${intervalMinutes} minutes`);
}

// Handle alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('[BMaestro] Alarm triggered, syncing...');
    client.sync().catch(err => {
      console.error('[BMaestro] Sync failed:', err);
    });
  }
});

// Listen for incoming sync operations
client.onSync((operations) => {
  console.log('[BMaestro] Received sync delta:', operations.length, 'operations');
  applyOperations(operations);
});

// Apply operations from other browsers
async function applyOperations(operations: SyncOperation[]): Promise<void> {
  for (const op of operations) {
    try {
      // Extract nativeId from operation payload to prevent echo
      const payload = op.payload as any;
      const nativeId = payload.nativeId || payload.parentNativeId;

      if (nativeId) {
        recentlySyncedIds.add(nativeId);
        setTimeout(() => recentlySyncedIds.delete(nativeId), DEDUPE_TIMEOUT_MS);
      }

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

// Listen for bookmark changes and queue operations
chrome.bookmarks.onCreated.addListener(async (id, bookmark) => {
  if (recentlySyncedIds.has(id)) {
    console.log('[BMaestro] Skipping echo for created bookmark:', id);
    return;
  }

  console.log('[BMaestro] Bookmark created:', id);

  client.queueOperation({
    id: crypto.randomUUID(),
    opType: 'ADD',
    bookmarkId: id,
    payload: {
      nativeId: id,
      parentNativeId: bookmark.parentId,
      title: bookmark.title,
      url: bookmark.url,
      index: bookmark.index,
    },
    timestamp: new Date().toISOString(),
  });

  // Immediate sync for user actions
  client.sync().catch(err => console.error('[BMaestro] Sync failed:', err));
});

chrome.bookmarks.onChanged.addListener(async (id, changes) => {
  if (recentlySyncedIds.has(id)) {
    console.log('[BMaestro] Skipping echo for changed bookmark:', id);
    return;
  }

  console.log('[BMaestro] Bookmark changed:', id);

  client.queueOperation({
    id: crypto.randomUUID(),
    opType: 'UPDATE',
    bookmarkId: id,
    payload: {
      nativeId: id,
      title: changes.title,
      url: changes.url,
    },
    timestamp: new Date().toISOString(),
  });

  client.sync().catch(err => console.error('[BMaestro] Sync failed:', err));
});

chrome.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
  if (recentlySyncedIds.has(id)) {
    console.log('[BMaestro] Skipping echo for removed bookmark:', id);
    return;
  }

  console.log('[BMaestro] Bookmark removed:', id);

  client.queueOperation({
    id: crypto.randomUUID(),
    opType: 'DELETE',
    bookmarkId: id,
    payload: {
      nativeId: id,
      parentNativeId: removeInfo.parentId,
    },
    timestamp: new Date().toISOString(),
  });

  client.sync().catch(err => console.error('[BMaestro] Sync failed:', err));
});

chrome.bookmarks.onMoved.addListener(async (id, moveInfo) => {
  if (recentlySyncedIds.has(id)) {
    console.log('[BMaestro] Skipping echo for moved bookmark:', id);
    return;
  }

  console.log('[BMaestro] Bookmark moved:', id);

  client.queueOperation({
    id: crypto.randomUUID(),
    opType: 'MOVE',
    bookmarkId: id,
    payload: {
      nativeId: id,
      oldParentNativeId: moveInfo.oldParentId,
      newParentNativeId: moveInfo.parentId,
      oldIndex: moveInfo.oldIndex,
      newIndex: moveInfo.index,
    },
    timestamp: new Date().toISOString(),
  });

  client.sync().catch(err => console.error('[BMaestro] Sync failed:', err));
});

// Export for popup access
(globalThis as any).bmaestroClient = client;
(globalThis as any).bmaestroGetTree = buildBookmarkTree;
```

**Step 2: Build and verify**

Run: `cd /home/chip/bmaestro/packages/extension && npm run build`

**Step 3: Commit**

```bash
git add packages/extension/src/background.ts
git commit -m "feat(extension): switch to direct cloud sync with chrome.alarms"
```

---

### Task 3.3: Update popup with sync controls

**Files:**
- Modify: `packages/extension/src/popup.ts`
- Modify: `packages/extension/src/popup.css`
- Modify: `packages/extension/popup.html`

**Step 1: Update popup.html**

```html
<!-- packages/extension/popup.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="popup">
    <h1>BMaestro</h1>

    <div class="status-section">
      <div class="status-row">
        <span class="label">Status:</span>
        <span id="status" class="value">Checking...</span>
      </div>
      <div class="status-row">
        <span class="label">Last sync:</span>
        <span id="lastSync" class="value">Never</span>
      </div>
      <div class="status-row">
        <span class="label">Pending:</span>
        <span id="pending" class="value">0 operations</span>
      </div>
    </div>

    <div class="controls-section">
      <button id="syncNow" class="btn primary">Sync Now</button>

      <div class="interval-control">
        <label for="interval">Auto-sync every:</label>
        <select id="interval">
          <option value="1">1 minute</option>
          <option value="5" selected>5 minutes</option>
          <option value="15">15 minutes</option>
          <option value="30">30 minutes</option>
          <option value="60">1 hour</option>
        </select>
      </div>
    </div>

    <div class="config-section" id="configSection">
      <h2>Setup Required</h2>
      <div class="input-group">
        <label for="userId">User ID:</label>
        <input type="text" id="userId" placeholder="your-user-id">
      </div>
      <div class="input-group">
        <label for="syncSecret">Sync Secret:</label>
        <input type="password" id="syncSecret" placeholder="your-sync-secret">
      </div>
      <button id="saveConfig" class="btn">Save Configuration</button>
    </div>

    <div class="footer">
      <a href="https://bmaestro-dashboard.fly.dev" target="_blank">Open Dashboard</a>
    </div>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

**Step 2: Update popup.css**

```css
/* packages/extension/src/popup.css */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #333;
}

.popup {
  width: 300px;
  padding: 16px;
}

h1 {
  font-size: 18px;
  margin-bottom: 16px;
  color: #1a73e8;
}

h2 {
  font-size: 14px;
  margin-bottom: 12px;
  color: #666;
}

.status-section {
  background: #f5f5f5;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}

.status-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.status-row:last-child {
  margin-bottom: 0;
}

.label {
  color: #666;
}

.value {
  font-weight: 500;
}

.value.connected {
  color: #34a853;
}

.value.disconnected {
  color: #ea4335;
}

.value.syncing {
  color: #fbbc05;
}

.controls-section {
  margin-bottom: 16px;
}

.btn {
  width: 100%;
  padding: 10px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn.primary {
  background: #1a73e8;
  color: white;
}

.btn.primary:hover {
  background: #1557b0;
}

.btn.primary:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.btn:not(.primary) {
  background: #f5f5f5;
  color: #333;
  margin-top: 8px;
}

.btn:not(.primary):hover {
  background: #e5e5e5;
}

.interval-control {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.interval-control label {
  color: #666;
  font-size: 13px;
}

.interval-control select {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
}

.config-section {
  background: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}

.config-section.hidden {
  display: none;
}

.input-group {
  margin-bottom: 12px;
}

.input-group label {
  display: block;
  margin-bottom: 4px;
  color: #666;
  font-size: 13px;
}

.input-group input {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.footer {
  text-align: center;
  padding-top: 12px;
  border-top: 1px solid #eee;
}

.footer a {
  color: #1a73e8;
  text-decoration: none;
  font-size: 13px;
}

.footer a:hover {
  text-decoration: underline;
}
```

**Step 3: Update popup.ts**

```typescript
// packages/extension/src/popup.ts
import type { CloudClient } from './cloud/client.js';

interface BmaestroGlobals {
  bmaestroClient: CloudClient;
}

async function init(): Promise<void> {
  // Get references from background page
  const bg = await chrome.runtime.getBackgroundPage() as unknown as BmaestroGlobals | null;

  if (!bg?.bmaestroClient) {
    // Service worker context - need to use messaging
    console.log('[Popup] Using messaging API');
    initWithMessaging();
    return;
  }

  const client = bg.bmaestroClient;

  // UI elements
  const statusEl = document.getElementById('status')!;
  const lastSyncEl = document.getElementById('lastSync')!;
  const pendingEl = document.getElementById('pending')!;
  const syncNowBtn = document.getElementById('syncNow') as HTMLButtonElement;
  const intervalSelect = document.getElementById('interval') as HTMLSelectElement;
  const configSection = document.getElementById('configSection')!;
  const userIdInput = document.getElementById('userId') as HTMLInputElement;
  const syncSecretInput = document.getElementById('syncSecret') as HTMLInputElement;
  const saveConfigBtn = document.getElementById('saveConfig') as HTMLButtonElement;

  // Update status display
  function updateStatus(): void {
    const status = client.getStatus();

    if (!status.configured) {
      statusEl.textContent = 'Not configured';
      statusEl.className = 'value disconnected';
      configSection.classList.remove('hidden');
    } else {
      statusEl.textContent = 'Ready';
      statusEl.className = 'value connected';
      configSection.classList.add('hidden');
    }

    if (status.lastSync) {
      const lastSync = new Date(status.lastSync);
      const now = new Date();
      const diffMs = now.getTime() - lastSync.getTime();
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) {
        lastSyncEl.textContent = 'Just now';
      } else if (diffMins < 60) {
        lastSyncEl.textContent = `${diffMins} min ago`;
      } else {
        lastSyncEl.textContent = lastSync.toLocaleTimeString();
      }
    } else {
      lastSyncEl.textContent = 'Never';
    }

    pendingEl.textContent = `${status.pendingOps} operations`;
  }

  // Initial status
  updateStatus();

  // Load current interval
  const currentInterval = await client.getPollInterval();
  intervalSelect.value = String(currentInterval);

  // Sync now button
  syncNowBtn.addEventListener('click', async () => {
    syncNowBtn.disabled = true;
    syncNowBtn.textContent = 'Syncing...';
    statusEl.textContent = 'Syncing...';
    statusEl.className = 'value syncing';

    try {
      const result = await client.sync();
      if (result.success) {
        statusEl.textContent = 'Sync complete';
        statusEl.className = 'value connected';
      } else {
        statusEl.textContent = result.error || 'Sync failed';
        statusEl.className = 'value disconnected';
      }
    } catch (err) {
      statusEl.textContent = 'Sync failed';
      statusEl.className = 'value disconnected';
    }

    syncNowBtn.disabled = false;
    syncNowBtn.textContent = 'Sync Now';
    updateStatus();
  });

  // Interval change
  intervalSelect.addEventListener('change', async () => {
    const minutes = parseInt(intervalSelect.value);
    await client.setPollInterval(minutes);

    // Update alarm
    await chrome.alarms.clear('bmaestro-sync');
    chrome.alarms.create('bmaestro-sync', {
      delayInMinutes: minutes,
      periodInMinutes: minutes,
    });
  });

  // Save config
  saveConfigBtn.addEventListener('click', async () => {
    const userId = userIdInput.value.trim();
    const syncSecret = syncSecretInput.value.trim();

    if (!userId || !syncSecret) {
      alert('Please enter both User ID and Sync Secret');
      return;
    }

    await chrome.storage.local.set({ userId, syncSecret });

    // Reinitialize client
    await client.initialize();
    updateStatus();

    // Trigger initial sync
    syncNowBtn.click();
  });

  // Refresh status periodically
  setInterval(updateStatus, 5000);
}

// Fallback for service worker context
function initWithMessaging(): void {
  // For Manifest V3 service workers, we need to use messaging
  // This is a simplified version - full implementation would use chrome.runtime.sendMessage

  const statusEl = document.getElementById('status')!;
  statusEl.textContent = 'Service Worker Mode';

  const syncNowBtn = document.getElementById('syncNow') as HTMLButtonElement;
  syncNowBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
  });
}

document.addEventListener('DOMContentLoaded', init);
```

**Step 4: Build and verify**

Run: `cd /home/chip/bmaestro/packages/extension && npm run build`

**Step 5: Commit**

```bash
git add packages/extension/popup.html
git add packages/extension/src/popup.ts
git add packages/extension/src/popup.css
git commit -m "feat(extension): update popup with sync controls and config"
```

---

## Phase 4: Remove Daemon & Native Host

### Task 4.1: Remove native messaging from extension manifest

**Files:**
- Modify: `packages/extension/manifest.json`

**Step 1: Update manifest.json**

Remove the `nativeMessaging` permission and add `storage` and `alarms`:

```json
{
  "manifest_version": 3,
  "name": "BMaestro",
  "version": "1.0.0",
  "description": "Cross-browser bookmark sync",
  "permissions": [
    "bookmarks",
    "storage",
    "alarms"
  ],
  "host_permissions": [
    "https://bmaestro-sync.fly.dev/*",
    "https://bmaestro-pocketbase.fly.dev/*"
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

**Step 2: Commit**

```bash
git add packages/extension/manifest.json
git commit -m "feat(extension): remove nativeMessaging, add storage and alarms permissions"
```

---

### Task 4.2: Remove native client files from extension

**Files:**
- Delete: `packages/extension/src/native/client.ts`
- Delete: `packages/extension/src/native/` directory

**Step 1: Remove native directory**

```bash
rm -rf packages/extension/src/native
```

**Step 2: Commit**

```bash
git add -A packages/extension/src/native
git commit -m "chore(extension): remove native messaging client"
```

---

### Task 4.3: Mark native-host package as deprecated

**Files:**
- Create: `packages/native-host/DEPRECATED.md`

**Step 1: Create deprecation notice**

```markdown
# DEPRECATED

This package is no longer used. The extension now connects directly to the cloud sync service.

## What Changed

Previously:
```
Extension → Native Host → Daemon → Cloud
```

Now:
```
Extension → Cloud (direct HTTP/WebSocket)
```

## Files Kept for Reference

- `windows-setup/` - Windows installation scripts (no longer needed)
- `src/` - Source code (no longer needed)

## Migration

If you had the native host installed:

1. **Remove Windows Registry entries** (optional, they're harmless):
   ```powershell
   Remove-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.bmaestro.native_host"
   Remove-Item -Path "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.bmaestro.native_host"
   Remove-Item -Path "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.bmaestro.native_host"
   ```

2. **Delete installation folder** (optional):
   ```powershell
   Remove-Item -Recurse -Force "C:\bmaestro"
   ```

3. **Stop daemon** if running - it's no longer needed.

## Configuration

Extension now stores config in `chrome.storage.local`:
- `userId` - Your user ID
- `syncSecret` - Authentication secret
- `pollIntervalMinutes` - Sync interval (default: 5)

Configure via the extension popup.
```

**Step 2: Commit**

```bash
git add packages/native-host/DEPRECATED.md
git commit -m "docs(native-host): mark package as deprecated"
```

---

## Phase 5: Deploy and Test

### Task 5.1: Deploy updated sync-service to Fly.io

**Step 1: Build**

```bash
cd /home/chip/bmaestro/packages/sync-service && npm run build
```

**Step 2: Deploy**

```bash
cd /home/chip/bmaestro/packages/sync-service && fly deploy
```

**Step 3: Verify health endpoint**

```bash
curl https://bmaestro-sync.fly.dev/health
```

Expected: `{"status":"ok","timestamp":"..."}`

**Step 4: Commit any deployment changes**

```bash
git add -A
git commit -m "chore: deployment updates" --allow-empty
```

---

### Task 5.2: Deploy PocketBase migration

**Step 1: Deploy**

```bash
cd /home/chip/bmaestro/packages/pocketbase && fly deploy
```

**Step 2: Verify activity_log collection exists**

Visit: https://bmaestro-pocketbase.fly.dev/_/

---

### Task 5.3: Build and test extension

**Step 1: Build extension**

```bash
cd /home/chip/bmaestro/packages/extension && npm run build
```

**Step 2: Load in Chrome**

1. Go to `chrome://extensions`
2. Click "Update" on BMaestro extension
3. Open popup - should show "Not configured"

**Step 3: Configure extension**

1. Enter User ID (e.g., "chip")
2. Enter Sync Secret (from `~/.bmaestro/config.json` or Fly.io secrets)
3. Click Save

**Step 4: Test sync**

1. Click "Sync Now" - should complete
2. Add a bookmark in Chrome
3. Check Fly.io logs: `fly logs -a bmaestro-sync`
4. Load extension in Brave, configure, verify bookmark appears

---

### Task 5.4: Final cleanup commit

**Step 1: Ensure all changes committed**

```bash
git status
git add -A
git commit -m "feat: complete daemon removal - direct cloud sync"
```

---

## Summary

**Removed:**
- Native messaging entirely
- Daemon process
- Windows setup scripts (kept but deprecated)
- Shim process

**Added:**
- Direct HTTP sync endpoint (`POST /sync`)
- Activity log endpoint (`GET /activity`)
- PocketBase `activity_log` collection
- `chrome.alarms` for periodic sync
- Extension popup sync controls
- Configurable poll interval (1-60 minutes)

**User Experience:**
- No daemon to start
- Configure once in extension popup
- Auto-syncs every 5 minutes (configurable)
- Manual "Sync Now" button
- Works immediately after browser start

**Architecture:**
```
Extension (Chrome/Brave/Edge)
    ↓ HTTPS
bmaestro-sync.fly.dev
    ↓
bmaestro-pocketbase.fly.dev
```
