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

// Flag to prevent cleanup deletions from triggering sync
let isCleaningDuplicates = false;

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

  // Skip if no URL (folder) or check for existing bookmark with same URL
  if (payload.url) {
    const existing = await chrome.bookmarks.search({ url: payload.url });
    if (existing.length > 0) {
      console.log('[BMaestro] Skipping duplicate bookmark:', payload.url);
      return;
    }
  }

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
  const payload = op.payload as { nativeId: string; url?: string; title?: string };

  // Find bookmark by URL (since nativeId is browser-specific)
  if (payload.url) {
    const matches = await chrome.bookmarks.search({ url: payload.url });
    if (matches.length > 0) {
      // Delete the first match (or all matches with same URL)
      for (const match of matches) {
        try {
          // Add to recently synced to prevent echo
          recentlySyncedIds.add(match.id);
          setTimeout(() => recentlySyncedIds.delete(match.id), DEDUPE_TIMEOUT_MS);

          await chrome.bookmarks.remove(match.id);
          console.log('[BMaestro] Deleted bookmark by URL:', payload.url, 'id:', match.id);
        } catch (err) {
          console.error('[BMaestro] Failed to delete bookmark:', match.id, err);
        }
      }
      return;
    }
    console.log('[BMaestro] Bookmark not found for deletion:', payload.url);
    return;
  }

  // Fallback: try by nativeId (only works if same browser instance)
  try {
    await chrome.bookmarks.remove(payload.nativeId);
  } catch {
    // Try removing as tree (folder)
    try {
      await chrome.bookmarks.removeTree(payload.nativeId);
    } catch {
      console.log('[BMaestro] Could not delete bookmark:', payload.nativeId);
    }
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
  if (recentlySyncedIds.has(id) || isCleaningDuplicates) {
    console.log('[BMaestro] Skipping sync for removed bookmark:', id);
    return;
  }

  console.log('[BMaestro] Bookmark removed:', id, removeInfo.node);

  // Check if this browser is canonical (source of truth)
  const { isCanonical, userId, syncSecret } = await chrome.storage.local.get(['isCanonical', 'userId', 'syncSecret']);

  if (isCanonical) {
    // Canonical browser: delete syncs directly
    client.queueOperation({
      id: crypto.randomUUID(),
      opType: 'DELETE',
      bookmarkId: id,
      payload: {
        nativeId: id,
        parentNativeId: removeInfo.parentId,
        url: removeInfo.node.url,
        title: removeInfo.node.title,
      },
      timestamp: new Date().toISOString(),
    });

    client.sync().catch(err => console.error('[BMaestro] Sync failed:', err));
  } else {
    // Non-canonical browser: queue for moderation instead of direct delete
    console.log('[BMaestro] Queuing deletion for moderation (non-canonical browser)');

    if (userId && syncSecret) {
      try {
        await fetch('https://bmaestro-sync.fly.dev/moderation/queue', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${syncSecret}`,
            'X-User-Id': userId,
          },
          body: JSON.stringify({
            browser: browserType,
            url: removeInfo.node.url,
            title: removeInfo.node.title,
            parentId: removeInfo.parentId,
          }),
        });
        console.log('[BMaestro] Deletion queued for moderation');
      } catch (err) {
        console.error('[BMaestro] Failed to queue deletion for moderation:', err);
      }
    }
  }
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

// Clean duplicate bookmarks
async function cleanDuplicates(): Promise<{ removed: number; kept: number }> {
  console.log('[BMaestro] Starting duplicate cleanup...');
  isCleaningDuplicates = true;

  try {
    const tree = await chrome.bookmarks.getTree();
    const urlMap = new Map<string, chrome.bookmarks.BookmarkTreeNode[]>();

    // Collect all bookmarks by URL
    function collectBookmarks(node: chrome.bookmarks.BookmarkTreeNode): void {
      if (node.url) {
        const existing = urlMap.get(node.url) || [];
        existing.push(node);
        urlMap.set(node.url, existing);
      }
      if (node.children) {
        for (const child of node.children) {
          collectBookmarks(child);
        }
      }
    }

    for (const root of tree) {
      collectBookmarks(root);
    }

    // Find and remove duplicates (keep the first one)
    let removed = 0;
    let kept = 0;

    for (const [url, bookmarks] of urlMap) {
      if (bookmarks.length > 1) {
        // Keep the first one, remove the rest
        kept++;
        for (let i = 1; i < bookmarks.length; i++) {
          try {
            await chrome.bookmarks.remove(bookmarks[i].id);
            removed++;
            console.log('[BMaestro] Removed duplicate:', url);
          } catch (err) {
            console.error('[BMaestro] Failed to remove duplicate:', bookmarks[i].id, err);
          }
        }
      } else {
        kept++;
      }
    }

    console.log(`[BMaestro] Cleanup complete: kept ${kept}, removed ${removed} duplicates`);
    return { removed, kept };
  } finally {
    isCleaningDuplicates = false;
  }
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[BMaestro] Received message:', message.type);

  if (message.type === 'CLEAN_DUPLICATES') {
    console.log('[BMaestro] Starting clean duplicates handler...');
    cleanDuplicates()
      .then((result) => {
        console.log('[BMaestro] Clean duplicates success:', result);
        sendResponse({ success: true, ...result });
      })
      .catch(err => {
        console.error('[BMaestro] Clean duplicates failed:', err, err.stack);
        sendResponse({ success: false, error: err.message || String(err) });
      });
    return true;
  }

  if (message.type === 'SYNC_NOW') {
    client.sync()
      .then((result) => {
        sendResponse({ success: result.success, error: result.error });
      })
      .catch(err => {
        console.error('[BMaestro] Sync failed:', err);
        sendResponse({ success: false, error: String(err) });
      });
    return true; // Keep channel open for async response
  }

  if (message.type === 'FULL_SYNC') {
    performFullSync()
      .then((result) => {
        sendResponse(result);
      })
      .catch(err => {
        console.error('[BMaestro] Full sync failed:', err);
        sendResponse({ success: false, error: String(err) });
      });
    return true;
  }
});

// Full sync - export all bookmarks
async function performFullSync(): Promise<{ success: boolean; count: number; error?: string }> {
  console.log('[BMaestro] Starting full sync...');

  try {
    const tree = await chrome.bookmarks.getTree();
    let count = 0;

    // Recursively process all bookmarks
    function processNode(node: chrome.bookmarks.BookmarkTreeNode): void {
      // Skip root nodes
      if (node.url) {
        // It's a bookmark
        client.queueOperation({
          id: crypto.randomUUID(),
          opType: 'ADD',
          bookmarkId: node.id,
          payload: {
            nativeId: node.id,
            parentNativeId: node.parentId,
            title: node.title,
            url: node.url,
            index: node.index,
          },
          timestamp: new Date().toISOString(),
        });
        count++;
      }

      // Process children
      if (node.children) {
        for (const child of node.children) {
          processNode(child);
        }
      }
    }

    for (const root of tree) {
      processNode(root);
    }

    console.log(`[BMaestro] Queued ${count} bookmarks for sync`);

    // Now sync
    const result = await client.sync();

    return {
      success: result.success,
      count,
      error: result.error,
    };
  } catch (err) {
    console.error('[BMaestro] Full sync error:', err);
    return {
      success: false,
      count: 0,
      error: String(err),
    };
  }
}

// Export for popup access
(globalThis as any).bmaestroClient = client;
(globalThis as any).bmaestroGetTree = buildBookmarkTree;
