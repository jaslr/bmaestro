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

    const pending = queueOperation(userId, {
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
    const items = getPendingOperations(userId);
    json(res, { items });
    return true;
  }

  // POST /moderation/:id/accept - Accept an operation
  if (path.match(/^\/moderation\/[^/]+\/accept$/) && method === 'POST') {
    const id = path.split('/')[2];
    const accepted = acceptOperation(userId, id);

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
    const rejected = rejectOperation(userId, id);

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
    const accepted = acceptAllOperations(userId);

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
    const rejected = rejectAllOperations(userId);

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

  return false; // Not handled, let WebSocket handle
}
