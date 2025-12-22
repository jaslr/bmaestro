import { CloudConnection } from './cloud-connection.js';
import { NativeMessaging } from './native-messaging.js';
import { NativeRequest, NativeResponse, WSServerMessage } from '@bmaestro/shared/types';
import { ChunkAccumulator, chunkMessage } from '@bmaestro/shared/protocol';
import { randomUUID } from 'crypto';

const SYNC_SERVICE_URL = process.env.SYNC_SERVICE_URL ?? 'wss://bmaestro-sync.fly.dev/ws';
const DEVICE_ID = process.env.DEVICE_ID ?? `device-${randomUUID().slice(0, 8)}`;
const USER_ID = process.env.USER_ID ?? 'default-user';

console.log(`[Daemon] Starting BMaestro Native Host Daemon`);
console.log(`[Daemon] Device ID: ${DEVICE_ID}`);
console.log(`[Daemon] Sync Service: ${SYNC_SERVICE_URL}`);

// Initialize cloud connection
const cloud = new CloudConnection({
  url: SYNC_SERVICE_URL,
  deviceId: DEVICE_ID,
  userId: USER_ID,
});

// Track connected extensions (browser -> NativeMessaging instance)
const extensions = new Map<string, NativeMessaging>();
const chunkAccumulator = new ChunkAccumulator();

// Handle messages from cloud
cloud.on('message', (message: WSServerMessage) => {
  console.log(`[Daemon] Cloud message: ${message.type}`);

  // Forward to all connected extensions
  for (const [browser, nm] of extensions) {
    const response: NativeResponse = {
      id: randomUUID(),
      type: message.type === 'SYNC_DELTA' ? 'SYNC_DELTA' : 'ACK',
      payload: message as unknown as Record<string, unknown>,
    };

    // Chunk if necessary
    const chunks = chunkMessage(response);
    for (const chunk of chunks) {
      nm.write(chunk).catch((err) => {
        console.error(`[Daemon] Error sending to ${browser}:`, err);
      });
    }
  }
});

cloud.on('connected', () => {
  console.log('[Daemon] Connected to cloud');
});

cloud.on('disconnected', () => {
  console.log('[Daemon] Disconnected from cloud');
});

cloud.on('error', (error: Error) => {
  console.error('[Daemon] Cloud error:', error.message);
});

// Connect to cloud
cloud.connect();

// Keep process alive
process.on('SIGINT', () => {
  console.log('[Daemon] Shutting down...');
  cloud.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Daemon] Shutting down...');
  cloud.disconnect();
  process.exit(0);
});

// Export for native messaging shim to connect
export { cloud, extensions, chunkAccumulator };
