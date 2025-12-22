import { createServer } from 'http';
import { createWebSocketServer } from './websocket/server.js';
import { handleHttpRequest } from './http/routes.js';

const PORT = parseInt(process.env.PORT ?? '8080', 10);

const server = createServer(async (req, res) => {
  // Try HTTP routes first
  const handled = await handleHttpRequest(req, res);
  if (handled) return;

  // Health check fallback (also handled in routes, but keep for compatibility)
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
