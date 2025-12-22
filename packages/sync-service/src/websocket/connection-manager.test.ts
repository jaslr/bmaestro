import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionManager, DeviceConnection } from './connection-manager.js';

describe('ConnectionManager', () => {
  let manager: ConnectionManager;

  beforeEach(() => {
    manager = new ConnectionManager();
  });

  it('registers a new device connection', () => {
    const mockSocket = { readyState: 1 } as any;

    manager.register('device-1', 'chrome', 'user-1', mockSocket);

    expect(manager.getDevice('device-1')).toBeDefined();
    expect(manager.getDevice('device-1')?.browserType).toBe('chrome');
  });

  it('returns undefined for unknown device', () => {
    expect(manager.getDevice('unknown')).toBeUndefined();
  });

  it('lists all devices for a user', () => {
    const mockSocket = { readyState: 1 } as any;

    manager.register('device-1', 'chrome', 'user-1', mockSocket);
    manager.register('device-2', 'brave', 'user-1', mockSocket);
    manager.register('device-3', 'edge', 'user-2', mockSocket);

    const user1Devices = manager.getDevicesForUser('user-1');
    expect(user1Devices).toHaveLength(2);
  });

  it('removes a device on disconnect', () => {
    const mockSocket = { readyState: 1 } as any;

    manager.register('device-1', 'chrome', 'user-1', mockSocket);
    manager.disconnect('device-1');

    expect(manager.getDevice('device-1')).toBeUndefined();
  });

  it('broadcasts message to all user devices except sender', () => {
    const messages: string[] = [];
    const mockSocket1 = {
      readyState: 1,
      send: (msg: string) => messages.push(`1:${msg}`)
    } as any;
    const mockSocket2 = {
      readyState: 1,
      send: (msg: string) => messages.push(`2:${msg}`)
    } as any;

    manager.register('device-1', 'chrome', 'user-1', mockSocket1);
    manager.register('device-2', 'brave', 'user-1', mockSocket2);

    manager.broadcastToUser('user-1', '{"test": true}', 'device-1');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe('2:{"test": true}');
  });
});
