# Full Moderation for Non-Canonical Browser Operations

**Date:** 2026-01-07
**Status:** Approved

## Overview

Extend the moderation system to handle all bookmark operations (ADD, UPDATE, DELETE) from non-canonical browsers, not just deletes. The source of truth (canonical browser) must approve all changes before they sync.

## Current Behavior

- **Canonical browser:** All operations sync directly
- **Non-canonical browsers:**
  - Deletes → Moderation queue (requires approval)
  - Adds/Updates → Sync directly (no approval)

## New Behavior

- **Canonical browser:** All operations sync directly (unchanged)
- **Non-canonical browsers:** ALL operations go to moderation queue
  - Bookmarks exist locally immediately
  - Sync to canonical only after approval
  - On reject: reversal sent to originating browser

## Backend Changes (sync-service)

### Expanded Moderation Data Structure

```typescript
interface ModerationItem {
  id: string;
  userId: string;
  browser: string;
  operationType: 'ADD' | 'UPDATE' | 'DELETE';
  url?: string;
  title: string;
  folderPath?: string;
  parentId?: string;
  // For UPDATE - store previous values for revert
  previousTitle?: string;
  previousUrl?: string;
  previousParentId?: string;
  createdAt: Date;
}
```

### Endpoint Changes

**POST /moderation/queue**
- Add `operationType` field (default: 'DELETE' for backwards compatibility)
- Accept full payload including previous values for updates

**POST /moderation/:id/accept**
Handle by operation type:
- ADD: Queue sync operation to push bookmark to canonical, then sync to all
- UPDATE: Queue sync operation with new values, sync to all
- DELETE: Delete from all browsers (current behavior)

**POST /moderation/:id/reject**
Send reversal to originating browser:
- ADD: Send DELETE to remove bookmark from originating browser
- UPDATE: Send UPDATE with previousTitle/previousUrl to revert
- DELETE: No action (bookmark was never deleted from canonical)

**POST /moderation/accept-all, /moderation/reject-all**
Process each item according to its operation type.

## Extension Changes (background.ts)

### Route Non-Canonical Operations to Moderation

```typescript
// onCreated listener
chrome.bookmarks.onCreated.addListener(async (id, bookmark) => {
  const { isCanonical } = await chrome.storage.local.get(['isCanonical']);

  if (!isCanonical) {
    await fetch('/moderation/queue', {
      method: 'POST',
      body: JSON.stringify({
        operationType: 'ADD',
        browser: browserType,
        url: bookmark.url,
        title: bookmark.title,
        folderPath: await getFolderPath(bookmark.parentId),
      })
    });
    return; // Don't sync directly
  }

  // Canonical: sync as normal
  client.queueOperation({ ... });
});

// onChanged listener
chrome.bookmarks.onChanged.addListener(async (id, changes) => {
  const { isCanonical } = await chrome.storage.local.get(['isCanonical']);

  if (!isCanonical) {
    // Get previous values from cache
    const previous = bookmarkCache.get(id);

    await fetch('/moderation/queue', {
      method: 'POST',
      body: JSON.stringify({
        operationType: 'UPDATE',
        browser: browserType,
        url: changes.url,
        title: changes.title,
        previousUrl: previous?.url,
        previousTitle: previous?.title,
      })
    });
    return;
  }

  // Canonical: sync as normal
});

// onRemoved - already routes to moderation for non-canonical
```

### Bookmark Cache for Previous Values

Maintain in-memory cache of bookmark state to capture previous values for UPDATE operations:

```typescript
const bookmarkCache = new Map<string, { title: string; url?: string }>();

// Populate on startup and after each sync
async function refreshBookmarkCache() {
  const tree = await chrome.bookmarks.getTree();
  bookmarkCache.clear();

  function cacheNode(node: BookmarkTreeNode) {
    if (node.url) {
      bookmarkCache.set(node.id, { title: node.title, url: node.url });
    }
    node.children?.forEach(cacheNode);
  }

  tree.forEach(cacheNode);
}
```

## Popup UI Changes (popup.ts)

### Moderation List Display

Text-based operation type prefix (no icons):

```
ADD: Project Documentation
Added by brave · work/projects
                       [Accept] [Reject]

UPDATE: Google renamed to "Google Search"
Updated by edge · bookmarks bar
                       [Accept] [Reject]

DELETE: Old Blog Post
Deleted by brave · reading/archived
                       [Accept] [Reject]

        [Accept All]         [Reject All]
```

### Display Logic

- ADD: "ADD: {title}" + "Added by {browser} · {folderPath}"
- UPDATE: "UPDATE: {title}" + "Updated by {browser}"
- DELETE: "DELETE: {title}" + "Deleted by {browser}"

## Edge Cases

1. **Originating browser offline during reject:** Reversal operation queued, applied on next sync
2. **Bookmark manually deleted before reject:** Ignore gracefully
3. **Multiple pending operations on same bookmark:** Process in order, skip if bookmark no longer exists

## Implementation Order

1. Backend: Expand moderation data structure and endpoints
2. Extension: Add bookmark cache for previous values
3. Extension: Route ADD operations to moderation
4. Extension: Route UPDATE operations to moderation
5. Extension: Handle reversal operations from reject
6. Popup: Update moderation UI for all operation types
7. Testing: End-to-end test all flows
