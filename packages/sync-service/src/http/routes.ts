import { IncomingMessage, ServerResponse } from 'http';
import { logActivity, getActivityLog } from './activity-logger.js';
import { processSyncRequest } from '../sync/processor.js';
import { handleExtensionDownload } from './extension-download.js';
import { handleVersionCheck } from './version.js';
import { handleUpdateManifest } from './update-manifest.js';
import {
  queueDeletion,
  getPendingDeletions,
  acceptDeletion,
  rejectDeletion,
  acceptAllDeletions,
  rejectAllDeletions,
  setCanonicalBrowser,
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

  // Health check (no auth)
  if (path === '/health') {
    json(res, { status: 'ok', timestamp: new Date().toISOString() });
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

  // POST /moderation/queue - Queue a deletion for moderation
  if (path === '/moderation/queue' && method === 'POST') {
    const body = await parseBody(req);

    const pending = queueDeletion(userId, {
      browser: body.browser || 'unknown',
      url: body.url,
      title: body.title,
      parentId: body.parentId,
    });

    json(res, { success: true, id: pending.id });
    return true;
  }

  // GET /moderation/pending - Get pending deletions
  if (path === '/moderation/pending' && method === 'GET') {
    const items = getPendingDeletions(userId);
    json(res, { items });
    return true;
  }

  // POST /moderation/:id/accept - Accept a deletion
  if (path.match(/^\/moderation\/[^/]+\/accept$/) && method === 'POST') {
    const id = path.split('/')[2];
    const accepted = acceptDeletion(userId, id);

    if (!accepted) {
      json(res, { error: 'Deletion not found' }, 404);
      return true;
    }

    // Log the deletion as accepted (it will be synced to other browsers)
    await logActivity({
      user_id: userId,
      device_id: 'moderation',
      action: 'BOOKMARK_DELETE',
      bookmark_url: accepted.url,
      bookmark_title: accepted.title,
      browser_type: accepted.browser as 'chrome' | 'brave' | 'edge',
      timestamp: new Date().toISOString(),
    });

    json(res, { success: true, deleted: accepted });
    return true;
  }

  // POST /moderation/:id/reject - Reject a deletion
  if (path.match(/^\/moderation\/[^/]+\/reject$/) && method === 'POST') {
    const id = path.split('/')[2];
    const rejected = rejectDeletion(userId, id);

    if (!rejected) {
      json(res, { error: 'Deletion not found' }, 404);
      return true;
    }

    json(res, { success: true, rejected });
    return true;
  }

  // POST /moderation/accept-all - Accept all pending deletions
  if (path === '/moderation/accept-all' && method === 'POST') {
    const accepted = acceptAllDeletions(userId);

    for (const item of accepted) {
      await logActivity({
        user_id: userId,
        device_id: 'moderation',
        action: 'BOOKMARK_DELETE',
        bookmark_url: item.url,
        bookmark_title: item.title,
        browser_type: item.browser as 'chrome' | 'brave' | 'edge',
        timestamp: new Date().toISOString(),
      });
    }

    json(res, { success: true, count: accepted.length });
    return true;
  }

  // POST /moderation/reject-all - Reject all pending deletions
  if (path === '/moderation/reject-all' && method === 'POST') {
    const rejected = rejectAllDeletions(userId);
    json(res, { success: true, count: rejected.length });
    return true;
  }

  return false; // Not handled, let WebSocket handle
}
