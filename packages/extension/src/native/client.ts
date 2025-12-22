import type { NativeRequest, NativeResponse, BrowserType } from '@bmaestro/shared/types';
import { ChunkAccumulator, chunkMessage, type MessageChunk, type SingleMessage } from '@bmaestro/shared/protocol';
import { v4 as uuidv4 } from 'uuid';

const NATIVE_HOST_NAME = 'com.bmaestro.native_host';

type ResponseHandler = (response: NativeResponse) => void;
type ErrorHandler = (error: Error) => void;

export class NativeClient {
  private port: chrome.runtime.Port | null = null;
  private pendingRequests = new Map<string, {
    resolve: ResponseHandler;
    reject: ErrorHandler;
    timeout: NodeJS.Timeout;
  }>();
  private chunkAccumulator = new ChunkAccumulator();
  private browserType: BrowserType;
  private onSyncDelta?: (operations: unknown[]) => void;

  constructor(browserType: BrowserType) {
    this.browserType = browserType;
  }

  connect(): void {
    if (this.port) return;

    try {
      this.port = chrome.runtime.connectNative(NATIVE_HOST_NAME);

      this.port.onMessage.addListener((message) => {
        this.handleMessage(message);
      });

      this.port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        console.error('[Native] Disconnected:', error?.message ?? 'Unknown reason');
        this.port = null;

        // Reject all pending requests
        for (const [id, { reject, timeout }] of this.pendingRequests) {
          clearTimeout(timeout);
          reject(new Error('Native host disconnected'));
        }
        this.pendingRequests.clear();
      });

      console.log('[Native] Connected to native host');
    } catch (err) {
      console.error('[Native] Failed to connect:', err);
      throw err;
    }
  }

  disconnect(): void {
    if (this.port) {
      this.port.disconnect();
      this.port = null;
    }
  }

  private handleMessage(message: unknown): void {
    // Check if it's a chunk
    if (typeof message === 'object' && message !== null && 'type' in message) {
      const msg = message as { type: string };

      if (msg.type === 'CHUNK') {
        const chunk = message as MessageChunk;
        const complete = this.chunkAccumulator.addChunk<NativeResponse>(chunk);
        if (complete) {
          this.processResponse(complete);
        }
        return;
      }

      if (msg.type === 'SINGLE') {
        const single = message as SingleMessage<NativeResponse>;
        this.processResponse(single.data);
        return;
      }
    }

    // Treat as direct response
    this.processResponse(message as NativeResponse);
  }

  private processResponse(response: NativeResponse): void {
    // Handle sync delta broadcasts
    if (response.type === 'SYNC_DELTA' && response.payload) {
      if (this.onSyncDelta) {
        this.onSyncDelta((response.payload as { operations?: unknown[] }).operations ?? []);
      }
      return;
    }

    // Handle request responses
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.id);

      if (response.error) {
        pending.reject(new Error(response.error));
      } else {
        pending.resolve(response);
      }
    }
  }

  async send(type: NativeRequest['type'], payload?: Record<string, unknown>): Promise<NativeResponse> {
    if (!this.port) {
      throw new Error('Not connected to native host');
    }

    const request: NativeRequest = {
      id: uuidv4(),
      type,
      payload,
      browser: this.browserType,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error('Request timeout'));
      }, 30000);

      this.pendingRequests.set(request.id, { resolve, reject, timeout });

      // Chunk if necessary
      const chunks = chunkMessage(request);
      for (const chunk of chunks) {
        this.port!.postMessage(chunk);
      }
    });
  }

  onSync(handler: (operations: unknown[]) => void): void {
    this.onSyncDelta = handler;
  }

  async getStatus(): Promise<{ connected: boolean; version: string }> {
    const response = await this.send('GET_STATUS');
    return response.payload as { connected: boolean; version: string };
  }

  async checkInSync(): Promise<void> {
    await this.send('CHECK_IN_SYNC');
  }
}
