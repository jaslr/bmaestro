import type { WebSocket } from 'ws';
import type { BrowserType } from '@bmaestro/shared/types';

export interface DeviceConnection {
  deviceId: string;
  browserType: BrowserType;
  userId: string;
  socket: WebSocket;
  connectedAt: Date;
  lastSeen: Date;
}

export class ConnectionManager {
  private devices = new Map<string, DeviceConnection>();
  private userDevices = new Map<string, Set<string>>();

  register(
    deviceId: string,
    browserType: BrowserType,
    userId: string,
    socket: WebSocket
  ): void {
    const connection: DeviceConnection = {
      deviceId,
      browserType,
      userId,
      socket,
      connectedAt: new Date(),
      lastSeen: new Date(),
    };

    this.devices.set(deviceId, connection);

    if (!this.userDevices.has(userId)) {
      this.userDevices.set(userId, new Set());
    }
    this.userDevices.get(userId)!.add(deviceId);
  }

  getDevice(deviceId: string): DeviceConnection | undefined {
    return this.devices.get(deviceId);
  }

  getDevicesForUser(userId: string): DeviceConnection[] {
    const deviceIds = this.userDevices.get(userId);
    if (!deviceIds) return [];

    return Array.from(deviceIds)
      .map(id => this.devices.get(id))
      .filter((d): d is DeviceConnection => d !== undefined);
  }

  disconnect(deviceId: string): void {
    const connection = this.devices.get(deviceId);
    if (!connection) return;

    this.devices.delete(deviceId);
    this.userDevices.get(connection.userId)?.delete(deviceId);
  }

  broadcastToUser(userId: string, message: string, excludeDeviceId?: string): void {
    const devices = this.getDevicesForUser(userId);

    for (const device of devices) {
      if (device.deviceId === excludeDeviceId) continue;
      if (device.socket.readyState !== 1) continue; // OPEN = 1

      device.socket.send(message);
    }
  }

  updateLastSeen(deviceId: string): void {
    const connection = this.devices.get(deviceId);
    if (connection) {
      connection.lastSeen = new Date();
    }
  }

  getConnectionCount(): number {
    return this.devices.size;
  }
}
