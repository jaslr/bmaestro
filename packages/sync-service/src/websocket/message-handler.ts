import type { WebSocket } from 'ws';
import { WSClientMessage, WSServerMessage } from '@bmaestro/shared/types';
import type { ConnectionManager } from './connection-manager.js';

export class MessageHandler {
  constructor(private connectionManager: ConnectionManager) {}

  handleMessage(
    deviceId: string,
    rawMessage: string,
    socket?: WebSocket,
    userId?: string
  ): void {
    let parsed: WSClientMessage;

    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      this.sendError(deviceId, 'INVALID_JSON', 'Message is not valid JSON');
      return;
    }

    // Validate message structure
    const result = WSClientMessage.safeParse(parsed);
    if (!result.success) {
      this.sendError(deviceId, 'INVALID_MESSAGE', 'Invalid message format');
      return;
    }

    const message = result.data;

    switch (message.type) {
      case 'PING':
        this.handlePing(deviceId);
        break;

      case 'REGISTER_DEVICE':
        if (socket && userId) {
          this.handleRegister(deviceId, message, socket, userId);
        }
        break;

      case 'CHECK_IN':
        this.handleCheckIn(deviceId, message);
        break;

      case 'SYNC_OPS':
        this.handleSyncOps(deviceId, message);
        break;

      case 'CHUNK_START':
      case 'CHUNK_DATA':
      case 'CHUNK_END':
        this.handleChunk(deviceId, message);
        break;
    }
  }

  private handlePing(deviceId: string): void {
    this.send(deviceId, { type: 'PONG' });
  }

  private handleRegister(
    deviceId: string,
    message: Extract<WSClientMessage, { type: 'REGISTER_DEVICE' }>,
    socket: WebSocket,
    userId: string
  ): void {
    this.connectionManager.register(
      message.deviceId,
      message.browserType,
      userId,
      socket
    );
    this.send(deviceId, { type: 'ACK', requestId: deviceId });
  }

  private handleCheckIn(
    deviceId: string,
    message: Extract<WSClientMessage, { type: 'CHECK_IN' }>
  ): void {
    this.connectionManager.updateLastSeen(deviceId);

    // TODO: Query database for operations since lastSyncVersion
    this.send(deviceId, {
      type: 'SYNC_DELTA',
      operations: [],
      currentVersion: message.lastSyncVersion,
      yourVersion: message.lastSyncVersion,
    });
  }

  private handleSyncOps(
    deviceId: string,
    message: Extract<WSClientMessage, { type: 'SYNC_OPS' }>
  ): void {
    const device = this.connectionManager.getDevice(deviceId);
    if (!device) return;

    // TODO: Persist operations to database
    // TODO: Detect conflicts
    // Broadcast to other devices
    this.connectionManager.broadcastToUser(
      device.userId,
      JSON.stringify({
        type: 'SYNC_DELTA',
        operations: message.operations,
        currentVersion: Date.now(),
        yourVersion: Date.now(),
      }),
      deviceId
    );

    this.send(deviceId, { type: 'ACK', requestId: deviceId });
  }

  private handleChunk(
    deviceId: string,
    message: Extract<WSClientMessage, { type: 'CHUNK_START' | 'CHUNK_DATA' | 'CHUNK_END' }>
  ): void {
    // TODO: Implement chunk accumulation
    if (message.type === 'CHUNK_DATA') {
      this.send(deviceId, {
        type: 'CHUNK_ACK',
        chunkId: message.chunkId,
        receivedChunks: message.index + 1,
      });
    }
  }

  private send(deviceId: string, message: WSServerMessage): void {
    const device = this.connectionManager.getDevice(deviceId);
    if (!device || device.socket.readyState !== 1) return;

    device.socket.send(JSON.stringify(message));
  }

  private sendError(deviceId: string, code: string, message: string): void {
    this.send(deviceId, { type: 'ERROR', code, message });
  }
}
