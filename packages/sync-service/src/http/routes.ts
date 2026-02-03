import { IncomingMessage, ServerResponse } from 'http';
import { logActivity, getActivityLog } from './activity-logger.js';
import { processSyncRequest } from '../sync/processor.js';
import { handleExtensionDownload } from './extension-download.js';
import { handleVersionCheck } from './version.js';
import { handleUpdateManifest } from './update-manifest.js';
import {
  queueOperation,
  queueDeletion,
  getPendingOperations,
  getPendingDeletions,
  acceptOperation,
  acceptDeletion,
  rejectOperation,
  rejectDeletion,
  acceptAllOperations,
  acceptAllDeletions,
  rejectAllOperations,
  rejectAllDeletions,
  setCanonicalBrowser,
  getCanonicalBrowser,
  type OperationType,
  type PendingOperation,
} from './moderation.js';

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

  // Health check (no auth) - styled HTML page
  if (path === '/health') {
    // Format timestamp in Sydney AU time
    const now = new Date();
    const sydneyTime = now.toLocaleString('en-AU', {
      timeZone: 'Australia/Sydney',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).replace(',', '');

    const uptime = process.uptime();
    const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>BMaestro Service Status</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg-base: #0a0a0c;
      --bg-elevated: #12141a;
      --cyan: #00d4d4;
      --cyan-dim: #007a7a;
      --amber: #d4a000;
      --text-primary: #e0e0e0;
      --text-dim: #606068;
    }
    body {
      font-family: 'JetBrains Mono', 'Consolas', monospace;
      background: var(--bg-base);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: var(--bg-elevated);
      padding: 40px;
      max-width: 480px;
      width: 100%;
    }
    h1 {
      font-size: 14px;
      font-weight: 600;
      color: var(--cyan);
      text-transform: uppercase;
      letter-spacing: 0.15em;
      margin-bottom: 32px;
    }
    .status-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid var(--bg-base);
    }
    .status-row:last-child { border-bottom: none; }
    .label {
      color: var(--text-dim);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    .value {
      font-size: 12px;
      font-weight: 500;
    }
    .value.ok { color: var(--cyan); }
    .value.time { color: var(--text-primary); }
    .footer {
      margin-top: 32px;
      text-align: center;
      color: var(--text-dim);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>BMaestro Service Status</h1>
    <div class="status-row">
      <span class="label">Status</span>
      <span class="value ok">● ONLINE</span>
    </div>
    <div class="status-row">
      <span class="label">Last Check</span>
      <span class="value time">${sydneyTime}</span>
    </div>
    <div class="status-row">
      <span class="label">Uptime</span>
      <span class="value time">${uptimeStr}</span>
    </div>
    <div class="status-row">
      <span class="label">Region</span>
      <span class="value time">Sydney (SYD)</span>
    </div>
    <div class="footer">bmaestro-sync.fly.dev</div>
  </div>
</body>
</html>`);
    return true;
  }

  // Extension download (no auth)
  if (path.startsWith('/download') || path === '/install') {
    return handleExtensionDownload(req, res);
  }

  // Update manifest for Chrome auto-update (no auth)
  if (path === '/update.xml') {
    return handleUpdateManifest(req, res);
  }

  // Version check (no auth)
  if (path.startsWith('/version')) {
    return handleVersionCheck(req, res);
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

  // POST /clear-operations - Clear all sync operations for user (for fresh start)
  if (path === '/clear-operations' && method === 'POST') {
    try {
      const { pb } = await import('../pocketbase.js');

      // Get all operations for this user
      const ops = await pb.collection('sync_operations').getFullList({
        filter: `user_id = "${userId}"`,
      });

      // Delete them all
      let deleted = 0;
      for (const op of ops) {
        await pb.collection('sync_operations').delete(op.id);
        deleted++;
      }

      console.log(`[Clear] Deleted ${deleted} operations for user ${userId}`);

      // Log the action
      await logActivity({
        user_id: userId,
        device_id: 'system',
        browser_type: 'chrome',
        action: 'OPERATIONS_CLEARED',
        details: { deleted },
        timestamp: new Date().toISOString(),
      });

      json(res, { success: true, deleted });
    } catch (err) {
      console.error('[Clear] Error clearing operations:', err);
      json(res, { error: 'Failed to clear operations', details: String(err) }, 500);
    }
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

  // GET /canonical - Check current canonical browser
  if (path === '/canonical' && method === 'GET') {
    const current = getCanonicalBrowser(userId);
    json(res, { canonicalBrowser: current || 'none' });
    return true;
  }

  // POST /canonical - Set canonical browser status
  if (path === '/canonical' && method === 'POST') {
    const body = await parseBody(req);
    const browserType = req.headers['x-browser-type'] as string || 'unknown';

    if (body.isCanonical) {
      setCanonicalBrowser(userId, browserType);
    } else {
      setCanonicalBrowser(userId, null);
    }

    json(res, { success: true });
    return true;
  }

  // POST /moderation/queue - Queue an operation for moderation
  if (path === '/moderation/queue' && method === 'POST') {
    const body = await parseBody(req);
    const operationType: OperationType = body.operationType || 'DELETE';

    const pending = await queueOperation(userId, {
      browser: body.browser || 'unknown',
      operationType,
      url: body.url,
      title: body.title,
      folderPath: body.folderPath,
      parentId: body.parentId,
      // For UPDATE operations - store previous values
      previousTitle: body.previousTitle,
      previousUrl: body.previousUrl,
      previousParentId: body.previousParentId,
    });

    json(res, { success: true, id: pending.id, operationType });
    return true;
  }

  // GET /moderation/pending - Get pending operations
  if (path === '/moderation/pending' && method === 'GET') {
    const items = await getPendingOperations(userId);
    json(res, { items });
    return true;
  }

  // POST /moderation/:id/accept - Accept an operation
  if (path.match(/^\/moderation\/[^/]+\/accept$/) && method === 'POST') {
    const id = path.split('/')[2];
    const accepted = await acceptOperation(userId, id);

    if (!accepted) {
      json(res, { error: 'Operation not found' }, 404);
      return true;
    }

    // Log based on operation type
    const actionMap: Record<OperationType, string> = {
      'ADD': 'BOOKMARK_ADD',
      'UPDATE': 'BOOKMARK_UPDATE',
      'DELETE': 'BOOKMARK_DELETE',
    };

    await logActivity({
      user_id: userId,
      device_id: 'moderation',
      action: actionMap[accepted.operationType],
      bookmark_url: accepted.url,
      bookmark_title: accepted.title,
      browser_type: accepted.browser as 'chrome' | 'brave' | 'edge',
      timestamp: new Date().toISOString(),
    });

    // Queue accepted operation for syncing to all browsers
    try {
      const { pb } = await import('../pocketbase.js');
      const newVersion = Date.now();

      if (accepted.operationType === 'ADD') {
        // Queue ADD operation
        await pb.collection('sync_operations').create({
          user_id: userId,
          device_id: 'moderation-accepted',
          op_type: 'ADD',
          bookmark_id: `accepted-${accepted.id}`,
          payload: {
            url: accepted.url,
            title: accepted.title,
            folderPath: accepted.folderPath,
            parentNativeId: accepted.parentId,
            isModerated: true,
          },
          version: newVersion,
          timestamp: newVersion,
        });
        console.log(`[Moderation] Queued ADD for sync: ${accepted.title}`);
      } else if (accepted.operationType === 'UPDATE') {
        // Queue UPDATE operation
        await pb.collection('sync_operations').create({
          user_id: userId,
          device_id: 'moderation-accepted',
          op_type: 'UPDATE',
          bookmark_id: `accepted-${accepted.id}`,
          payload: {
            url: accepted.url,
            title: accepted.title,
            isModerated: true,
          },
          version: newVersion,
          timestamp: newVersion,
        });
        console.log(`[Moderation] Queued UPDATE for sync: ${accepted.title}`);
      } else if (accepted.operationType === 'DELETE') {
        // Queue DELETE operation
        await pb.collection('sync_operations').create({
          user_id: userId,
          device_id: 'moderation-accepted',
          op_type: 'DELETE',
          bookmark_id: `accepted-${accepted.id}`,
          payload: {
            url: accepted.url,
            title: accepted.title,
            isModerated: true,
          },
          version: newVersion,
          timestamp: newVersion,
        });
        console.log(`[Moderation] Queued DELETE for sync: ${accepted.title}`);
      }
    } catch (err) {
      console.error('[Moderation] Failed to queue accepted operation:', err);
    }

    json(res, { success: true, accepted, operationType: accepted.operationType });
    return true;
  }

  // POST /moderation/:id/reject - Reject an operation
  if (path.match(/^\/moderation\/[^/]+\/reject$/) && method === 'POST') {
    const id = path.split('/')[2];
    const rejected = await rejectOperation(userId, id);

    if (!rejected) {
      json(res, { error: 'Operation not found' }, 404);
      return true;
    }

    // Queue reversal operation for the originating browser to undo
    try {
      const { pb } = await import('../pocketbase.js');
      const newVersion = Date.now();

      if (rejected.operationType === 'ADD' && rejected.url) {
        // Reject ADD: Queue DELETE to remove from originating browser
        await pb.collection('sync_operations').create({
          user_id: userId,
          device_id: 'moderation-reversal',
          op_type: 'DELETE',
          bookmark_id: `reversal-${rejected.id}`,
          payload: {
            url: rejected.url,
            title: rejected.title,
            isReversal: true,
          },
          version: newVersion,
          timestamp: newVersion,
        });
        console.log(`[Moderation] Queued DELETE reversal for rejected ADD: ${rejected.title}`);
      } else if (rejected.operationType === 'UPDATE' && rejected.previousTitle) {
        // Reject UPDATE: Queue UPDATE with previous values to revert
        await pb.collection('sync_operations').create({
          user_id: userId,
          device_id: 'moderation-reversal',
          op_type: 'UPDATE',
          bookmark_id: `reversal-${rejected.id}`,
          payload: {
            url: rejected.previousUrl || rejected.url,
            title: rejected.previousTitle,
            newTitle: rejected.previousTitle,
            newUrl: rejected.previousUrl,
            isReversal: true,
          },
          version: newVersion,
          timestamp: newVersion,
        });
        console.log(`[Moderation] Queued UPDATE reversal for rejected UPDATE: ${rejected.title} -> ${rejected.previousTitle}`);
      }
      // DELETE rejections need no reversal - bookmark stays
    } catch (err) {
      console.error('[Moderation] Failed to queue reversal:', err);
    }

    // Return rejected with reversal info
    json(res, { success: true, rejected, operationType: rejected.operationType });
    return true;
  }

  // POST /moderation/accept-all - Accept all pending operations
  if (path === '/moderation/accept-all' && method === 'POST') {
    const accepted = await acceptAllOperations(userId);

    const actionMap: Record<OperationType, string> = {
      'ADD': 'BOOKMARK_ADD',
      'UPDATE': 'BOOKMARK_UPDATE',
      'DELETE': 'BOOKMARK_DELETE',
    };

    // Log and queue all accepted operations
    try {
      const { pb } = await import('../pocketbase.js');
      const newVersion = Date.now();

      for (const item of accepted) {
        await logActivity({
          user_id: userId,
          device_id: 'moderation',
          action: actionMap[item.operationType],
          bookmark_url: item.url,
          bookmark_title: item.title,
          browser_type: item.browser as 'chrome' | 'brave' | 'edge',
          timestamp: new Date().toISOString(),
        });

        // Queue for sync
        await pb.collection('sync_operations').create({
          user_id: userId,
          device_id: 'moderation-accepted',
          op_type: item.operationType,
          bookmark_id: `accepted-${item.id}`,
          payload: {
            url: item.url,
            title: item.title,
            folderPath: item.folderPath,
            parentNativeId: item.parentId,
            isModerated: true,
          },
          version: newVersion,
          timestamp: newVersion,
        });
      }
      console.log(`[Moderation] Queued ${accepted.length} accepted operations for sync`);
    } catch (err) {
      console.error('[Moderation] Failed to queue accepted operations:', err);
    }

    json(res, { success: true, count: accepted.length, accepted });
    return true;
  }

  // POST /moderation/reject-all - Reject all pending operations
  if (path === '/moderation/reject-all' && method === 'POST') {
    const rejected = await rejectAllOperations(userId);

    // Queue reversal operations for all rejected items
    try {
      const { pb } = await import('../pocketbase.js');
      const newVersion = Date.now();

      for (const item of rejected) {
        if (item.operationType === 'ADD' && item.url) {
          // Reject ADD: Queue DELETE
          await pb.collection('sync_operations').create({
            user_id: userId,
            device_id: 'moderation-reversal',
            op_type: 'DELETE',
            bookmark_id: `reversal-${item.id}`,
            payload: {
              url: item.url,
              title: item.title,
              isReversal: true,
            },
            version: newVersion,
            timestamp: newVersion,
          });
        } else if (item.operationType === 'UPDATE' && item.previousTitle) {
          // Reject UPDATE: Queue UPDATE with previous values
          await pb.collection('sync_operations').create({
            user_id: userId,
            device_id: 'moderation-reversal',
            op_type: 'UPDATE',
            bookmark_id: `reversal-${item.id}`,
            payload: {
              url: item.previousUrl || item.url,
              title: item.previousTitle,
              newTitle: item.previousTitle,
              newUrl: item.previousUrl,
              isReversal: true,
            },
            version: newVersion,
            timestamp: newVersion,
          });
        }
      }
      console.log(`[Moderation] Queued reversals for ${rejected.length} rejected operations`);
    } catch (err) {
      console.error('[Moderation] Failed to queue reversals:', err);
    }

    // Return all rejected items
    json(res, { success: true, count: rejected.length, rejected });
    return true;
  }

  // ===== DIAGNOSTIC ENDPOINTS =====

  // GET /devices/feed - Per-browser/device activity feed
  if (path === '/devices/feed' && method === 'GET') {
    try {
      const { pb } = await import('../pocketbase.js');

      const browser = url.searchParams.get('browser') || undefined;
      const device = url.searchParams.get('device') || undefined;
      const actionsParam = url.searchParams.get('actions') || undefined;
      const rawLimit = parseInt(url.searchParams.get('limit') || '100');
      const limit = Math.min(Math.max(rawLimit, 1), 200);

      const filter: string[] = [`user_id = "${userId}"`];
      if (browser) filter.push(`browser_type = "${browser}"`);
      if (device) filter.push(`device_id = "${device}"`);
      if (actionsParam) {
        const actions = actionsParam.split(',').map(a => a.trim()).filter(Boolean);
        if (actions.length > 0) {
          const actionFilters = actions.map(a => `action = "${a}"`).join(' || ');
          filter.push(`(${actionFilters})`);
        }
      }

      const filterStr = filter.join(' && ');

      const result = await pb.collection('activity_log').getList(1, limit, {
        filter: filterStr,
        sort: '-timestamp',
      });

      const items = result.items.map((item: any) => {
        let direction: 'outgoing' | 'incoming' = 'outgoing';
        if (item.action === 'SYNC_COMPLETED' && item.details) {
          const details = typeof item.details === 'string' ? JSON.parse(item.details) : item.details;
          if ((details.operationsReceived || 0) > 0 && (details.operationsSent || 0) === 0) {
            direction = 'incoming';
          } else if ((details.operationsSent || 0) > 0) {
            direction = 'outgoing';
          }
        }

        return {
          timestamp: item.timestamp,
          action: item.action,
          browser: item.browser_type,
          device_id: item.device_id,
          title: item.bookmark_title || null,
          url: item.bookmark_url || null,
          details: item.details || null,
          direction,
        };
      });

      json(res, {
        items,
        device_id: device || null,
        browser: browser || null,
        totalItems: result.totalItems,
      });
    } catch (err) {
      console.error('[Devices/Feed] Error:', err);
      json(res, { error: 'Failed to fetch device feed', details: String(err) }, 500);
    }
    return true;
  }

  // GET /devices/compare - Compare recent actions between two browsers
  if (path === '/devices/compare' && method === 'GET') {
    const browser1 = url.searchParams.get('browser1');
    const browser2 = url.searchParams.get('browser2');
    const rawLimit = parseInt(url.searchParams.get('limit') || '100');
    const limit = Math.min(Math.max(rawLimit, 1), 200);

    if (!browser1 || !browser2) {
      json(res, { error: 'browser1 and browser2 query params are required' }, 400);
      return true;
    }

    try {
      const { pb } = await import('../pocketbase.js');

      // Helper to build filter - identifier could be browser_type or device_id
      const buildFilter = (identifier: string) => {
        const base = `user_id = "${userId}"`;
        // Try both browser_type and device_id matching
        return `${base} && (browser_type = "${identifier}" || device_id = "${identifier}")`;
      };

      // Get all actions for each browser
      const [result1, result2] = await Promise.all([
        pb.collection('activity_log').getList(1, limit, {
          filter: buildFilter(browser1),
          sort: '-timestamp',
        }),
        pb.collection('activity_log').getList(1, limit, {
          filter: buildFilter(browser2),
          sort: '-timestamp',
        }),
      ]);

      // Find last sync for each
      const findLastSync = (items: any[]) => {
        const sync = items.find((i: any) => i.action === 'SYNC_COMPLETED');
        return sync?.timestamp || null;
      };

      // Filter to bookmark actions only (not SYNC_COMPLETED)
      const bookmarkActions = (items: any[]) =>
        items.filter((i: any) => i.action?.startsWith('BOOKMARK_'));

      const b1BookmarkActions = bookmarkActions(result1.items);
      const b2BookmarkActions = bookmarkActions(result2.items);

      // Build URL sets for discrepancy detection
      const b1Adds = new Map<string, any>();
      const b2Adds = new Map<string, any>();
      const b1Deletes = new Set<string>();
      const b2Deletes = new Set<string>();

      for (const item of b1BookmarkActions) {
        if (item.action === 'BOOKMARK_ADDED' && item.bookmark_url) {
          b1Adds.set(item.bookmark_url, item);
        } else if (item.action === 'BOOKMARK_DELETED' && item.bookmark_url) {
          b1Deletes.add(item.bookmark_url);
        }
      }
      for (const item of b2BookmarkActions) {
        if (item.action === 'BOOKMARK_ADDED' && item.bookmark_url) {
          b2Adds.set(item.bookmark_url, item);
        } else if (item.action === 'BOOKMARK_DELETED' && item.bookmark_url) {
          b2Deletes.add(item.bookmark_url);
        }
      }

      const discrepancies: any[] = [];

      // URLs added in browser1 but not in browser2
      for (const [urlStr, item] of b1Adds) {
        if (!b2Adds.has(urlStr)) {
          discrepancies.push({
            type: 'missing_in_browser2',
            action: 'BOOKMARK_ADDED',
            title: item.bookmark_title || null,
            url: urlStr,
            source_browser: browser1,
            timestamp: item.timestamp,
          });
        }
      }

      // URLs added in browser2 but not in browser1
      for (const [urlStr, item] of b2Adds) {
        if (!b1Adds.has(urlStr)) {
          discrepancies.push({
            type: 'missing_in_browser1',
            action: 'BOOKMARK_ADDED',
            title: item.bookmark_title || null,
            url: urlStr,
            source_browser: browser2,
            timestamp: item.timestamp,
          });
        }
      }

      // Deletes in browser1 not in browser2
      for (const urlStr of b1Deletes) {
        if (!b2Deletes.has(urlStr)) {
          discrepancies.push({
            type: 'missing_in_browser2',
            action: 'BOOKMARK_DELETED',
            url: urlStr,
            source_browser: browser1,
          });
        }
      }

      // Deletes in browser2 not in browser1
      for (const urlStr of b2Deletes) {
        if (!b1Deletes.has(urlStr)) {
          discrepancies.push({
            type: 'missing_in_browser1',
            action: 'BOOKMARK_DELETED',
            url: urlStr,
            source_browser: browser2,
          });
        }
      }

      const formatActions = (items: any[]) =>
        items.map((i: any) => ({
          timestamp: i.timestamp,
          action: i.action,
          title: i.bookmark_title || null,
          url: i.bookmark_url || null,
          device_id: i.device_id,
        }));

      const b1MissingCount = discrepancies.filter(d => d.type === 'missing_in_browser2').length;
      const b2MissingCount = discrepancies.filter(d => d.type === 'missing_in_browser1').length;
      let summary = `${browser1} has ${result1.totalItems} actions, ${browser2} has ${result2.totalItems}.`;
      if (b1MissingCount > 0) {
        summary += ` ${b1MissingCount} bookmark actions from ${browser1} are not mirrored in ${browser2}.`;
      }
      if (b2MissingCount > 0) {
        summary += ` ${b2MissingCount} bookmark actions from ${browser2} are not mirrored in ${browser1}.`;
      }
      if (b1MissingCount === 0 && b2MissingCount === 0) {
        summary += ' No discrepancies found.';
      }

      json(res, {
        browser1: {
          identifier: browser1,
          lastSync: findLastSync(result1.items),
          totalActions: result1.totalItems,
          recentActions: formatActions(b1BookmarkActions),
        },
        browser2: {
          identifier: browser2,
          lastSync: findLastSync(result2.items),
          totalActions: result2.totalItems,
          recentActions: formatActions(b2BookmarkActions),
        },
        discrepancies,
        summary,
      });
    } catch (err) {
      console.error('[Devices/Compare] Error:', err);
      json(res, { error: 'Failed to compare devices', details: String(err) }, 500);
    }
    return true;
  }

  // GET /devices/errors - Recent errors and failures
  if (path === '/devices/errors' && method === 'GET') {
    try {
      const { pb } = await import('../pocketbase.js');

      const rawLimit = parseInt(url.searchParams.get('limit') || '50');
      const limit = Math.min(Math.max(rawLimit, 1), 200);
      const browser = url.searchParams.get('browser') || undefined;

      // Filter for error-like actions
      const errorPatterns = ['FAIL', 'ERROR', 'CONFLICT'];
      const actionFilters = errorPatterns.map(p => `action ~ "${p}"`).join(' || ');

      const filter: string[] = [`user_id = "${userId}"`, `(${actionFilters})`];
      if (browser) filter.push(`browser_type = "${browser}"`);

      const filterStr = filter.join(' && ');

      const result = await pb.collection('activity_log').getList(1, limit, {
        filter: filterStr,
        sort: '-timestamp',
      });

      // Build summary
      const byBrowser: Record<string, number> = { chrome: 0, brave: 0, edge: 0 };
      const byAction: Record<string, number> = {};

      for (const item of result.items) {
        const bt = (item as any).browser_type || 'unknown';
        if (bt in byBrowser) byBrowser[bt]++;
        const action = (item as any).action || 'UNKNOWN';
        byAction[action] = (byAction[action] || 0) + 1;
      }

      const items = result.items.map((item: any) => {
        const details = item.details || {};
        return {
          timestamp: item.timestamp,
          browser: item.browser_type,
          device_id: item.device_id,
          action: item.action,
          error: details.error || details.message || item.bookmark_title || null,
          details,
        };
      });

      json(res, {
        items,
        summary: {
          totalErrors: result.totalItems,
          byBrowser,
          byAction,
        },
      });
    } catch (err) {
      console.error('[Devices/Errors] Error:', err);
      json(res, { error: 'Failed to fetch errors', details: String(err) }, 500);
    }
    return true;
  }

  // GET /devices/status - Overview of all known devices for user
  if (path === '/devices/status' && method === 'GET') {
    try {
      const { pb } = await import('../pocketbase.js');

      // Get all activity for this user to discover devices
      // We fetch a large batch sorted by timestamp descending to find unique devices
      const allActivity = await pb.collection('activity_log').getList(1, 500, {
        filter: `user_id = "${userId}"`,
        sort: '-timestamp',
      });

      // Build device map
      const deviceMap = new Map<string, {
        device_id: string;
        browser: string;
        lastActivity: string;
        lastSync: string | null;
        actionCount: number;
        recentBookmarkActions: number;
        lastBookmarkAction: any | null;
      }>();

      for (const item of allActivity.items) {
        const record = item as any;
        const deviceId = record.device_id;
        if (!deviceId || deviceId === 'system' || deviceId === 'moderation' || deviceId === 'moderation-accepted' || deviceId === 'moderation-reversal') continue;

        if (!deviceMap.has(deviceId)) {
          deviceMap.set(deviceId, {
            device_id: deviceId,
            browser: record.browser_type || 'unknown',
            lastActivity: record.timestamp,
            lastSync: null,
            actionCount: 0,
            recentBookmarkActions: 0,
            lastBookmarkAction: null,
          });
        }

        const dev = deviceMap.get(deviceId)!;
        dev.actionCount++;

        if (record.action === 'SYNC_COMPLETED' && !dev.lastSync) {
          dev.lastSync = record.timestamp;
        }

        if (record.action?.startsWith('BOOKMARK_')) {
          dev.recentBookmarkActions++;
          if (!dev.lastBookmarkAction) {
            dev.lastBookmarkAction = {
              action: record.action,
              title: record.bookmark_title || null,
              timestamp: record.timestamp,
            };
          }
        }
      }

      // Get canonical browser
      const canonical = getCanonicalBrowser(userId);

      // Get total server operations
      let serverOperations = 0;
      try {
        const opsResult = await pb.collection('sync_operations').getList(1, 1, {
          filter: `user_id = "${userId}"`,
        });
        serverOperations = opsResult.totalItems;
      } catch {
        // sync_operations might not exist or be empty
      }

      json(res, {
        devices: Array.from(deviceMap.values()),
        canonical: canonical || null,
        serverOperations,
      });
    } catch (err) {
      console.error('[Devices/Status] Error:', err);
      json(res, { error: 'Failed to fetch device status', details: String(err) }, 500);
    }
    return true;
  }

  return false; // Not handled, let WebSocket handle
}
