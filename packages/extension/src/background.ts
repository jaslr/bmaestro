// Must be first import - sets up browser shims for Node.js globals
import './shim.js';

import { CloudClient } from './cloud/client.js';
import { buildBookmarkTree } from './bookmarks/tree-builder.js';
import { checkForUpdate } from './updater.js';
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

// Folder type mapping - these are consistent folder names across browsers
type FolderType = 'bookmarks-bar' | 'other-bookmarks' | 'mobile-bookmarks' | 'unknown';

// Get the local browser's folder ID for a given folder type
async function getLocalFolderIdByType(folderType: FolderType): Promise<string | null> {
  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];

  if (!root.children) return null;

  for (const folder of root.children) {
    // Chrome/Brave/Edge all have these folder types
    // ID "1" is typically Bookmarks Bar, ID "2" is Other Bookmarks
    // But we check by title/position to be safe
    if (folder.title === 'Bookmarks Bar' || folder.title === 'Bookmarks bar') {
      if (folderType === 'bookmarks-bar') return folder.id;
    } else if (folder.title === 'Other Bookmarks' || folder.title === 'Other bookmarks') {
      if (folderType === 'other-bookmarks') return folder.id;
    } else if (folder.title === 'Mobile Bookmarks' || folder.title === 'Mobile bookmarks') {
      if (folderType === 'mobile-bookmarks') return folder.id;
    }
  }

  // Fallback: first child is usually bookmarks bar
  if (folderType === 'bookmarks-bar' && root.children.length > 0) {
    return root.children[0].id;
  }

  return null;
}

// Get folder type for a native folder ID
async function getFolderTypeById(folderId: string): Promise<FolderType> {
  try {
    const [folder] = await chrome.bookmarks.get(folderId);
    if (!folder) return 'unknown';

    const title = folder.title.toLowerCase();
    if (title.includes('bookmarks bar')) return 'bookmarks-bar';
    if (title.includes('other bookmark')) return 'other-bookmarks';
    if (title.includes('mobile bookmark')) return 'mobile-bookmarks';

    // Check if it's a direct child of root (meaning it's a special folder)
    if (folder.parentId === '0') {
      // First child of root is typically bookmarks bar
      const tree = await chrome.bookmarks.getTree();
      const root = tree[0];
      if (root.children && root.children[0]?.id === folderId) {
        return 'bookmarks-bar';
      }
      if (root.children && root.children[1]?.id === folderId) {
        return 'other-bookmarks';
      }
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

// Resolve a parent ID from another browser to this browser's equivalent
async function resolveParentId(foreignParentId: string, folderType?: FolderType): Promise<string> {
  // If we have a folder type, use it to find the local equivalent
  if (folderType && folderType !== 'unknown') {
    const localId = await getLocalFolderIdByType(folderType);
    if (localId) {
      console.log(`[BMaestro] Resolved folder type ${folderType} to local ID ${localId}`);
      return localId;
    }
  }

  // Fallback: try common ID mappings
  // All browsers typically use "1" for bookmarks bar, but check if it exists
  try {
    await chrome.bookmarks.get(foreignParentId);
    return foreignParentId;
  } catch {
    // ID doesn't exist, fall back to bookmarks bar
    const bookmarksBarId = await getLocalFolderIdByType('bookmarks-bar');
    console.log(`[BMaestro] Parent ID ${foreignParentId} not found, falling back to bookmarks bar (${bookmarksBarId})`);
    return bookmarksBarId || '1';
  }
}

// Flag to prevent cleanup deletions from triggering sync
let isCleaningDuplicates = false;

console.log(`[BMaestro] Starting on ${browserType}`);

// Force refresh extension icon using imageData (bypasses Chrome's icon cache)
async function refreshIcon(): Promise<void> {
  try {
    // Fetch icon as blob and convert to imageData
    const response = await fetch(chrome.runtime.getURL('icons/icon128.png'));
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    // Use OffscreenCanvas (available in service workers)
    const canvas = new OffscreenCanvas(128, 128);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, 128, 128);

      // Set icon using imageData - this bypasses file cache
      await chrome.action.setIcon({ imageData });
      console.log('[BMaestro] Icon refreshed via imageData');
    }
  } catch (err) {
    console.error('[BMaestro] Failed to refresh icon:', err);
  }
}

// Initialize client
client.initialize().then(() => {
  console.log('[BMaestro] CloudClient initialized');
  setupAlarm();
  refreshIcon(); // Force icon refresh on startup
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

// Handle alarm - sync bookmarks AND check for updates
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('[BMaestro] Alarm triggered, syncing and checking updates...');

    // Sync bookmarks
    client.sync().catch(err => {
      console.error('[BMaestro] Sync failed:', err);
    });

    // Check for extension updates
    try {
      const updateInfo = await checkForUpdate();
      if (updateInfo.updateAvailable) {
        console.log(`[BMaestro] Update available: ${updateInfo.currentVersion} -> ${updateInfo.latestVersion}`);

        // Store update info for popup
        await chrome.storage.local.set({
          updateAvailable: true,
          latestVersion: updateInfo.latestVersion,
          updateDownloadUrl: updateInfo.downloadUrl,
          badgeReason: `Update v${updateInfo.latestVersion} available`,
          badgeType: 'update',
        });

        // Set badge to indicate update - Chrome handles actual update delivery
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#03FFE3' });
      } else {
        // No update available - clear badge and stale storage
        await chrome.storage.local.remove(['updateAvailable', 'latestVersion', 'lastUpdateDownload', 'badgeReason', 'badgeType']);
        chrome.action.setBadgeText({ text: '' });
      }
    } catch (err) {
      console.error('[BMaestro] Update check failed:', err);
      // Store error for popup
      await chrome.storage.local.set({
        badgeReason: 'Update check failed',
        badgeType: 'error',
      });
    }
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
    folderType?: FolderType;
    folderPath?: string; // New: path like "Bookmarks Bar/Work/Projects"
    title: string;
    url?: string;
    index?: number;
    isFolder?: boolean;
  };

  // Handle folders - create them if they don't exist
  if (payload.isFolder || !payload.url) {
    console.log(`[BMaestro] Processing folder: ${payload.title}, path: ${payload.folderPath}`);

    // Resolve parent folder by path
    const parentId = await resolveParentByPath(payload.folderPath, payload.folderType);
    if (!parentId) {
      console.log('[BMaestro] Could not resolve parent for folder:', payload.title);
      return;
    }

    // Check if folder already exists in parent
    const parent = await chrome.bookmarks.getSubTree(parentId);
    const existingFolder = parent[0].children?.find(
      c => !c.url && c.title.toLowerCase() === payload.title.toLowerCase()
    );

    if (existingFolder) {
      console.log('[BMaestro] Folder already exists:', payload.title);
      return;
    }

    // Create the folder
    try {
      await chrome.bookmarks.create({
        parentId,
        title: payload.title,
      });
      console.log('[BMaestro] Created folder:', payload.title);
    } catch (err) {
      console.error('[BMaestro] Failed to create folder:', err);
    }
    return;
  }

  // Handle bookmarks - check for duplicates
  const existing = await chrome.bookmarks.search({ url: payload.url });
  if (existing.length > 0) {
    console.log('[BMaestro] Skipping duplicate bookmark:', payload.url);
    return;
  }

  // Resolve parent ID by path first, then fall back to folder type
  let parentId = await resolveParentByPath(payload.folderPath, payload.folderType);
  if (!parentId) {
    parentId = await resolveParentId(payload.parentNativeId, payload.folderType);
  }
  console.log(`[BMaestro] Creating bookmark in parent ${parentId} (path: ${payload.folderPath}, type: ${payload.folderType})`);

  try {
    await chrome.bookmarks.create({
      parentId,
      title: payload.title,
      url: payload.url,
    });
  } catch (err) {
    console.error('[BMaestro] Failed to create bookmark:', err);
    // Try creating in bookmarks bar as last resort
    const fallbackId = await getLocalFolderIdByType('bookmarks-bar');
    if (fallbackId && fallbackId !== parentId) {
      console.log('[BMaestro] Retrying in bookmarks bar...');
      await chrome.bookmarks.create({
        parentId: fallbackId,
        title: payload.title,
        url: payload.url,
      });
    }
  }
}

// Resolve parent folder by path (e.g., "Bookmarks Bar/Work/Projects")
async function resolveParentByPath(folderPath?: string, folderType?: FolderType): Promise<string | null> {
  if (!folderPath) return null;

  const parts = folderPath.split('/').filter(p => p.trim());
  if (parts.length === 0) return null;

  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];
  if (!root.children) return null;

  // First part should be a root folder type
  const rootName = parts[0].toLowerCase();
  let currentFolder: chrome.bookmarks.BookmarkTreeNode | undefined;

  for (const folder of root.children) {
    const title = folder.title.toLowerCase();
    if (rootName.includes('bookmarks bar') || rootName.includes('bookmark bar')) {
      if (title.includes('bookmarks bar') || title.includes('bookmark bar')) {
        currentFolder = folder;
        break;
      }
    } else if (rootName.includes('other bookmark')) {
      if (title.includes('other bookmark')) {
        currentFolder = folder;
        break;
      }
    } else if (rootName.includes('mobile bookmark')) {
      if (title.includes('mobile bookmark')) {
        currentFolder = folder;
        break;
      }
    }
  }

  // Fallback: use folderType if root not found by name
  if (!currentFolder && folderType) {
    const localId = await getLocalFolderIdByType(folderType);
    if (localId) {
      const [folder] = await chrome.bookmarks.get(localId);
      if (folder) {
        // Get full subtree
        const subtree = await chrome.bookmarks.getSubTree(localId);
        currentFolder = subtree[0];
      }
    }
  }

  if (!currentFolder) return null;

  // Navigate/create remaining path parts
  for (let i = 1; i < parts.length; i++) {
    const partName = parts[i];

    // Get fresh subtree for current folder
    const subtree = await chrome.bookmarks.getSubTree(currentFolder.id);
    const children = subtree[0].children || [];

    // Find matching child folder (case-insensitive)
    let childFolder = children.find(
      c => !c.url && c.title.toLowerCase() === partName.toLowerCase()
    );

    // Create folder if it doesn't exist
    if (!childFolder) {
      console.log(`[BMaestro] Creating folder "${partName}" in ${currentFolder.title}`);
      const created = await chrome.bookmarks.create({
        parentId: currentFolder.id,
        title: partName,
      });
      childFolder = created;
    }

    currentFolder = childFolder;
  }

  return currentFolder.id;
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

// Get full folder path for a folder ID
async function getFolderPath(folderId: string): Promise<string | undefined> {
  try {
    const pathParts: string[] = [];
    let currentId = folderId;

    while (currentId && currentId !== '0') {
      const [node] = await chrome.bookmarks.get(currentId);
      if (!node) break;

      pathParts.unshift(node.title);
      currentId = node.parentId || '';

      // Stop at root level (parentId === '0')
      if (node.parentId === '0') break;
    }

    return pathParts.length > 0 ? pathParts.join('/') : undefined;
  } catch (err) {
    console.error('[BMaestro] Failed to get folder path:', err);
    return undefined;
  }
}

// Listen for bookmark changes and queue operations
chrome.bookmarks.onCreated.addListener(async (id, bookmark) => {
  if (recentlySyncedIds.has(id)) {
    console.log('[BMaestro] Skipping echo for created bookmark:', id);
    return;
  }

  console.log('[BMaestro] Bookmark created:', id);

  // Get folder type and path for cross-browser compatibility
  const folderType = bookmark.parentId ? await getFolderTypeById(bookmark.parentId) : 'unknown';
  const folderPath = bookmark.parentId ? await getFolderPath(bookmark.parentId) : undefined;

  // Determine if this is a folder
  const isFolder = !bookmark.url;

  client.queueOperation({
    id: crypto.randomUUID(),
    opType: 'ADD',
    bookmarkId: id,
    payload: {
      nativeId: id,
      parentNativeId: bookmark.parentId,
      folderType,
      folderPath,
      title: bookmark.title,
      url: bookmark.url,
      index: bookmark.index,
      isFolder,
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

  // Combined sync + update check
  if (message.type === 'UPDATE_AND_SYNC') {
    (async () => {
      try {
        // Step 1: Sync bookmarks
        console.log('[BMaestro] UPDATE_AND_SYNC: Syncing bookmarks...');
        const syncResult = await client.sync();

        // Step 2: Check for updates
        console.log('[BMaestro] UPDATE_AND_SYNC: Checking for updates...');
        const updateInfo = await checkForUpdate();

        if (updateInfo.updateAvailable) {
          // Store update info
          await chrome.storage.local.set({
            updateAvailable: true,
            latestVersion: updateInfo.latestVersion,
            updateDownloadUrl: updateInfo.downloadUrl,
            badgeReason: `Update v${updateInfo.latestVersion} available`,
            badgeType: 'update',
          });

          // Set badge - Chrome handles actual update delivery
          chrome.action.setBadgeText({ text: '!' });
          chrome.action.setBadgeBackgroundColor({ color: '#03FFE3' });

          sendResponse({
            success: true,
            syncSuccess: syncResult.success,
            updateAvailable: true,
            currentVersion: updateInfo.currentVersion,
            latestVersion: updateInfo.latestVersion,
          });
        } else {
          // Clear update flag and badge
          await chrome.storage.local.set({ updateAvailable: false });
          await chrome.storage.local.remove(['badgeReason', 'badgeType']);
          chrome.action.setBadgeText({ text: '' });

          sendResponse({
            success: true,
            syncSuccess: syncResult.success,
            updateAvailable: false,
            currentVersion: updateInfo.currentVersion,
            latestVersion: updateInfo.latestVersion,
          });
        }
      } catch (err: any) {
        console.error('[BMaestro] UPDATE_AND_SYNC failed:', err);
        // Store error for popup
        await chrome.storage.local.set({
          badgeReason: `Sync error: ${err.message || String(err)}`,
          badgeType: 'error',
        });
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#D4A000' }); // Amber for errors
        sendResponse({ success: false, error: err.message || String(err) });
      }
    })();
    return true; // Keep channel open
  }

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

// Full sync - export all bookmarks AND folders
async function performFullSync(): Promise<{ success: boolean; count: number; error?: string }> {
  console.log('[BMaestro] Starting full sync...');

  try {
    const tree = await chrome.bookmarks.getTree();
    let bookmarkCount = 0;
    let folderCount = 0;

    // Build maps for folder info
    const folderTypeMap = new Map<string, FolderType>();
    const folderPathMap = new Map<string, string>(); // folder ID -> full path

    // Identify root folders and build paths
    const root = tree[0];
    if (root.children) {
      for (const folder of root.children) {
        const title = folder.title.toLowerCase();
        if (title.includes('bookmarks bar') || title.includes('bookmark bar')) {
          folderTypeMap.set(folder.id, 'bookmarks-bar');
          folderPathMap.set(folder.id, folder.title);
        } else if (title.includes('other bookmark')) {
          folderTypeMap.set(folder.id, 'other-bookmarks');
          folderPathMap.set(folder.id, folder.title);
        } else if (title.includes('mobile bookmark')) {
          folderTypeMap.set(folder.id, 'mobile-bookmarks');
          folderPathMap.set(folder.id, folder.title);
        }
      }
    }

    // First pass: collect all folders with their paths (breadth-first for proper ordering)
    const foldersToSync: Array<{
      node: chrome.bookmarks.BookmarkTreeNode;
      path: string;
      folderType: FolderType;
    }> = [];

    function collectFolders(node: chrome.bookmarks.BookmarkTreeNode, parentPath: string, parentFolderType: FolderType): void {
      if (!node.children) return;

      for (const child of node.children) {
        if (!child.url) {
          // It's a folder
          const childPath = parentPath ? `${parentPath}/${child.title}` : child.title;
          folderPathMap.set(child.id, childPath);

          // Inherit folder type from parent
          const childFolderType = folderTypeMap.get(child.id) || parentFolderType;
          folderTypeMap.set(child.id, childFolderType);

          // Only sync user folders (not root folders)
          if (!folderTypeMap.has(child.id) || parentPath) {
            foldersToSync.push({
              node: child,
              path: parentPath, // Parent path for creating this folder
              folderType: childFolderType,
            });
          }

          // Recurse into subfolders
          collectFolders(child, childPath, childFolderType);
        }
      }
    }

    // Start from root folders
    if (root.children) {
      for (const folder of root.children) {
        const folderType = folderTypeMap.get(folder.id) || 'unknown';
        collectFolders(folder, folder.title, folderType);
      }
    }

    // Queue folder operations (parent folders first due to breadth-first collection)
    for (const folder of foldersToSync) {
      client.queueOperation({
        id: crypto.randomUUID(),
        opType: 'ADD',
        bookmarkId: folder.node.id,
        payload: {
          nativeId: folder.node.id,
          parentNativeId: folder.node.parentId,
          folderType: folder.folderType,
          folderPath: folder.path,
          title: folder.node.title,
          isFolder: true,
        },
        timestamp: new Date().toISOString(),
      });
      folderCount++;
    }

    // Second pass: collect all bookmarks with their folder paths
    function processBookmarks(node: chrome.bookmarks.BookmarkTreeNode): void {
      if (node.url) {
        // Get folder info for the parent
        const folderType = node.parentId ? (folderTypeMap.get(node.parentId) || 'unknown') : 'unknown';
        const folderPath = node.parentId ? folderPathMap.get(node.parentId) : undefined;

        client.queueOperation({
          id: crypto.randomUUID(),
          opType: 'ADD',
          bookmarkId: node.id,
          payload: {
            nativeId: node.id,
            parentNativeId: node.parentId,
            folderType,
            folderPath,
            title: node.title,
            url: node.url,
            index: node.index,
          },
          timestamp: new Date().toISOString(),
        });
        bookmarkCount++;
      }

      // Process children
      if (node.children) {
        for (const child of node.children) {
          processBookmarks(child);
        }
      }
    }

    for (const rootNode of tree) {
      processBookmarks(rootNode);
    }

    console.log(`[BMaestro] Queued ${folderCount} folders and ${bookmarkCount} bookmarks for sync`);

    // Now sync
    const result = await client.sync();

    return {
      success: result.success,
      count: bookmarkCount + folderCount,
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
