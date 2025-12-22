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

// Constants
const CHECK_IN_INTERVAL_MS = 60_000;
const DEDUPE_TIMEOUT_MS = 2000;

// Track recently synced IDs to prevent infinite loops
const recentlySyncedIds = new Set<string>();

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

// Listen for bookmark changes
chrome.bookmarks.onCreated.addListener(async (id, bookmark) => {
  if (recentlySyncedIds.has(id)) {
    console.log('[BMaestro] Skipping echo for created bookmark:', id);
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
  if (recentlySyncedIds.has(id)) {
    console.log('[BMaestro] Skipping echo for changed bookmark:', id);
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
  if (recentlySyncedIds.has(id)) {
    console.log('[BMaestro] Skipping echo for removed bookmark:', id);
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
  if (recentlySyncedIds.has(id)) {
    console.log('[BMaestro] Skipping echo for moved bookmark:', id);
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
}, CHECK_IN_INTERVAL_MS);

// Export for popup access
(globalThis as any).bmaestroClient = client;
(globalThis as any).bmaestroGetTree = buildBookmarkTree;
