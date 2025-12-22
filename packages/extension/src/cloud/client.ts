import { CLOUD_CONFIG, getConfig, saveConfig, type StoredConfig } from './config.js';
import type { SyncOperation, BrowserType } from '@bmaestro/shared/types';

export interface SyncResult {
  success: boolean;
  operations: SyncOperation[];
  lastSyncVersion: number;
  conflicts?: Array<{
    localOp: SyncOperation;
    remoteOp: SyncOperation;
    resolution: 'local_wins' | 'remote_wins';
  }>;
  error?: string;
}

export class CloudClient {
  private browserType: BrowserType;
  private config: StoredConfig | null = null;
  private pendingOperations: SyncOperation[] = [];
  private syncInProgress = false;
  private syncHandlers: Array<(ops: SyncOperation[]) => void> = [];

  constructor(browserType: BrowserType) {
    this.browserType = browserType;
  }

  async initialize(): Promise<void> {
    this.config = await getConfig();

    // Generate device ID if not set
    if (!this.config.deviceId) {
      this.config.deviceId = `device-${crypto.randomUUID().slice(0, 8)}`;
      await saveConfig({ deviceId: this.config.deviceId });
    }
  }

  isConfigured(): boolean {
    return !!(this.config?.syncSecret && this.config?.userId);
  }

  getStatus(): { configured: boolean; lastSync: string | null; pendingOps: number } {
    return {
      configured: this.isConfigured(),
      lastSync: this.config?.lastSyncTime || null,
      pendingOps: this.pendingOperations.length,
    };
  }

  // Queue an operation for next sync
  queueOperation(op: SyncOperation): void {
    this.pendingOperations.push(op);
    console.log('[Cloud] Queued operation:', op.opType, 'pending:', this.pendingOperations.length);
  }

  // Register handler for incoming sync operations
  onSync(handler: (ops: SyncOperation[]) => void): void {
    this.syncHandlers.push(handler);
  }

  // Perform sync with cloud
  async sync(): Promise<SyncResult> {
    if (!this.config) {
      await this.initialize();
    }

    if (!this.isConfigured()) {
      return {
        success: false,
        operations: [],
        lastSyncVersion: 0,
        error: 'Not configured. Set syncSecret and userId in extension options.',
      };
    }

    if (this.syncInProgress) {
      return {
        success: false,
        operations: [],
        lastSyncVersion: this.config!.lastSyncVersion,
        error: 'Sync already in progress',
      };
    }

    this.syncInProgress = true;
    console.log('[Cloud] Starting sync, pending ops:', this.pendingOperations.length);

    try {
      const response = await fetch(CLOUD_CONFIG.syncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config!.syncSecret}`,
          'X-User-Id': this.config!.userId,
          'X-Device-Id': this.config!.deviceId,
          'X-Browser-Type': this.browserType,
        },
        body: JSON.stringify({
          operations: this.pendingOperations,
          lastSyncVersion: this.config!.lastSyncVersion,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sync failed: ${response.status} ${errorText}`);
      }

      const result: SyncResult = await response.json();

      // Clear pending operations that were sent
      this.pendingOperations = [];

      // Update stored config
      await saveConfig({
        lastSyncVersion: result.lastSyncVersion,
        lastSyncTime: new Date().toISOString(),
      });
      this.config!.lastSyncVersion = result.lastSyncVersion;
      this.config!.lastSyncTime = new Date().toISOString();

      // Notify handlers of incoming operations
      if (result.operations.length > 0) {
        console.log('[Cloud] Received', result.operations.length, 'operations to apply');
        for (const handler of this.syncHandlers) {
          handler(result.operations);
        }
      }

      console.log('[Cloud] Sync complete');
      return result;

    } catch (err) {
      console.error('[Cloud] Sync error:', err);
      return {
        success: false,
        operations: [],
        lastSyncVersion: this.config!.lastSyncVersion,
        error: String(err),
      };
    } finally {
      this.syncInProgress = false;
    }
  }

  // Get poll interval
  async getPollInterval(): Promise<number> {
    if (!this.config) await this.initialize();
    return this.config!.pollIntervalMinutes;
  }

  // Set poll interval
  async setPollInterval(minutes: number): Promise<void> {
    const clamped = Math.max(
      CLOUD_CONFIG.minPollIntervalMinutes,
      Math.min(CLOUD_CONFIG.maxPollIntervalMinutes, minutes)
    );
    await saveConfig({ pollIntervalMinutes: clamped });
    if (this.config) this.config.pollIntervalMinutes = clamped;
  }
}
