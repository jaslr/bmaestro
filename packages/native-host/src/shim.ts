#!/usr/bin/env node
import { NativeMessaging } from './native-messaging.js';
import { NativeRequest, NativeResponse, BrowserType } from '@bmaestro/shared/types';
import { ChunkAccumulator, chunkMessage, type MessageChunk } from '@bmaestro/shared/protocol';
import { randomUUID } from 'crypto';
import net from 'net';

const DAEMON_SOCKET_PATH = process.env.DAEMON_SOCKET ?? '/tmp/bmaestro-daemon.sock';

// Initialize native messaging with stdin/stdout
const nm = new NativeMessaging(process.stdin, process.stdout);
const chunkAccumulator = new ChunkAccumulator();

// Track pending requests
const pendingRequests = new Map<string, {
  resolve: (response: NativeResponse) => void;
  timeout: NodeJS.Timeout;
}>();

// Connect to daemon via Unix socket
let daemonSocket: net.Socket | null = null;

function connectToDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    daemonSocket = net.createConnection(DAEMON_SOCKET_PATH, () => {
      console.error('[Shim] Connected to daemon');
      resolve();
    });

    daemonSocket.on('error', (err) => {
      console.error('[Shim] Daemon connection error:', err.message);
      // Continue without daemon - extension can still work offline
      resolve();
    });

    daemonSocket.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString()) as NativeResponse;
        handleDaemonResponse(response);
      } catch (err) {
        console.error('[Shim] Error parsing daemon response:', err);
      }
    });

    daemonSocket.on('close', () => {
      console.error('[Shim] Daemon disconnected');
      daemonSocket = null;
    });
  });
}

function handleDaemonResponse(response: NativeResponse): void {
  // Forward response to extension
  const chunks = chunkMessage(response);
  for (const chunk of chunks) {
    nm.write(chunk).catch((err) => {
      console.error('[Shim] Error writing to extension:', err);
    });
  }
}

async function handleExtensionMessage(message: unknown): Promise<void> {
  // Check if it's a chunk
  if (typeof message === 'object' && message !== null && 'type' in message) {
    const msg = message as { type: string };

    if (msg.type === 'CHUNK') {
      const chunk = message as MessageChunk;
      const complete = chunkAccumulator.addChunk<NativeRequest>(chunk);
      if (complete) {
        await processRequest(complete);
      }
      return;
    }

    if (msg.type === 'SINGLE') {
      const single = message as { type: 'SINGLE'; data: NativeRequest };
      await processRequest(single.data);
      return;
    }
  }

  // Treat as direct request
  await processRequest(message as NativeRequest);
}

async function processRequest(request: NativeRequest): Promise<void> {
  console.error(`[Shim] Request: ${request.type}`);

  // Handle locally if possible
  if (request.type === 'GET_STATUS') {
    const response: NativeResponse = {
      id: request.id,
      type: 'STATUS',
      payload: {
        connected: daemonSocket !== null,
        version: '1.0.0',
      },
    };
    await nm.write({ type: 'SINGLE', data: response });
    return;
  }

  // Forward to daemon
  if (daemonSocket) {
    daemonSocket.write(JSON.stringify(request));
  } else {
    // Offline mode - acknowledge but note we're not syncing
    const response: NativeResponse = {
      id: request.id,
      type: 'ACK',
      payload: { offline: true },
    };
    await nm.write({ type: 'SINGLE', data: response });
  }
}

// Main loop
async function main(): Promise<void> {
  await connectToDaemon();

  // Process messages from extension
  while (true) {
    try {
      const message = await nm.read();
      await handleExtensionMessage(message);
    } catch (err) {
      if ((err as Error).message === 'Stream ended') {
        break;
      }
      console.error('[Shim] Error:', err);
    }
  }
}

main().catch((err) => {
  console.error('[Shim] Fatal error:', err);
  process.exit(1);
});
