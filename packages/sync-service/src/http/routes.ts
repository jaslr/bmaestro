import { IncomingMessage, ServerResponse } from 'http';
import { logActivity, getActivityLog } from './activity-logger.js';
import { processSyncRequest } from '../sync/processor.js';

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

  return false; // Not handled, let WebSocket handle
}
