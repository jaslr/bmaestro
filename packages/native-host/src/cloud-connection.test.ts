import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudConnection, ConnectionState } from './cloud-connection.js';

describe('CloudConnection', () => {
  it('starts in disconnected state', () => {
    const connection = new CloudConnection({
      url: 'ws://localhost:8080/ws',
      deviceId: 'test-device',
      userId: 'test-user',
    });

    expect(connection.state).toBe('disconnected');
  });

  it('emits state changes', async () => {
    const states: ConnectionState[] = [];
    const connection = new CloudConnection({
      url: 'ws://localhost:8080/ws',
      deviceId: 'test-device',
      userId: 'test-user',
      reconnectInterval: 100,
    });

    connection.on('stateChange', (state) => states.push(state));

    // Don't actually connect, just verify event system works
    connection.emit('stateChange', 'connecting');
    connection.emit('stateChange', 'connected');

    expect(states).toEqual(['connecting', 'connected']);
  });
});
