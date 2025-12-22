import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageHandler } from './message-handler.js';
import { ConnectionManager } from './connection-manager.js';

describe('MessageHandler', () => {
  let handler: MessageHandler;
  let connectionManager: ConnectionManager;
  let mockSocket: any;

  beforeEach(() => {
    connectionManager = new ConnectionManager();
    handler = new MessageHandler(connectionManager);
    mockSocket = {
      readyState: 1,
      send: vi.fn(),
    };
  });

  it('handles PING with PONG response', () => {
    connectionManager.register('device-1', 'chrome', 'user-1', mockSocket);

    handler.handleMessage('device-1', JSON.stringify({ type: 'PING' }));

    expect(mockSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'PONG' })
    );
  });

  it('handles REGISTER_DEVICE message', () => {
    handler.handleMessage('device-1', JSON.stringify({
      type: 'REGISTER_DEVICE',
      deviceId: 'device-1',
      browserType: 'chrome',
      deviceName: 'My Chrome',
    }), mockSocket, 'user-1');

    expect(connectionManager.getDevice('device-1')).toBeDefined();
  });

  it('handles CHECK_IN message', () => {
    connectionManager.register('device-1', 'chrome', 'user-1', mockSocket);

    handler.handleMessage('device-1', JSON.stringify({
      type: 'CHECK_IN',
      deviceId: 'device-1',
      lastSyncVersion: 0,
    }));

    expect(mockSocket.send).toHaveBeenCalled();
    const response = JSON.parse(mockSocket.send.mock.calls[0][0]);
    expect(response.type).toBe('SYNC_DELTA');
  });

  it('sends ERROR for invalid message format', () => {
    connectionManager.register('device-1', 'chrome', 'user-1', mockSocket);

    handler.handleMessage('device-1', 'not valid json');

    expect(mockSocket.send).toHaveBeenCalled();
    const response = JSON.parse(mockSocket.send.mock.calls[0][0]);
    expect(response.type).toBe('ERROR');
  });
});
