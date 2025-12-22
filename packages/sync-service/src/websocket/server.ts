import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { ConnectionManager } from './connection-manager.js';
import { MessageHandler } from './message-handler.js';

export interface WebSocketServerOptions {
  httpServer: HttpServer;
}

export function createWebSocketServer(options: WebSocketServerOptions): {
  wss: WebSocketServer;
  connectionManager: ConnectionManager;
} {
  const connectionManager = new ConnectionManager();
  const messageHandler = new MessageHandler(connectionManager);

  const wss = new WebSocketServer({
    server: options.httpServer,
    path: '/ws',
  });

  wss.on('connection', (socket: WebSocket, req) => {
    // Extract device ID from query params or generate temporary one
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    const deviceId = url.searchParams.get('deviceId') ?? `temp-${Date.now()}`;
    const userId = url.searchParams.get('userId') ?? 'anonymous';

    console.log(`[WS] Connection from device: ${deviceId}`);

    socket.on('message', (data) => {
      const message = data.toString();
      messageHandler.handleMessage(deviceId, message, socket, userId);
    });

    socket.on('close', () => {
      console.log(`[WS] Disconnected: ${deviceId}`);
      connectionManager.disconnect(deviceId);
    });

    socket.on('error', (error) => {
      console.error(`[WS] Error for ${deviceId}:`, error.message);
    });

    // Send initial ACK
    socket.send(JSON.stringify({ type: 'ACK', requestId: 'connect' }));
  });

  return { wss, connectionManager };
}
