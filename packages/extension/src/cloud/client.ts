import { CLOUD_CONFIG, EXTENSION_VERSION, getConfig, saveConfig, type StoredConfig } from './config.js';
import type { SyncOperation, BrowserType } from '@bmaestro/shared/types';

export interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
}

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

    // Generate device ID if not set (and persist it!)
    if (!this.config.deviceId) {
      this.config.deviceId = `device-${crypto.randomUUID().slice(0, 8)}`;
      await saveConfig({ deviceId: this.config.deviceId });
      console.log('[Cloud] Generated and saved new device ID:', this.config.deviceId);
    }

    // Load any pending operations from storage (survives service worker restart)
    await this.loadPendingOperations();
  }

  // Persist pending operations to storage so they survive service worker restarts
  private async savePendingOperations(): Promise<void> {
    await chrome.storage.local.set({ pendingOperations: this.pendingOperations });
  }

  // Load pending operations from storage
  private async loadPendingOperations(): Promise<void> {
    const result = await chrome.storage.local.get('pendingOperations');
    this.pendingOperations = result.pendingOperations || [];
    if (this.pendingOperations.length > 0) {
      console.log('[Cloud] Loaded', this.pendingOperations.length, 'pending operations from storage');
    }
  }

  // Clear pending operations from storage
  private async clearPendingOperations(): Promise<void> {
    this.pendingOperations = [];
    await chrome.storage.local.remove('pendingOperations');
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
  // Accepts partial operations and fills in defaults for vectorClock and sourceDeviceId
  async queueOperation(op: Omit<SyncOperation, 'vectorClock' | 'sourceDeviceId'> & Partial<Pick<SyncOperation, 'vectorClock' | 'sourceDeviceId'>>): Promise<void> {
    const fullOp: SyncOperation = {
      ...op,
      vectorClock: op.vectorClock || {},
      sourceDeviceId: op.sourceDeviceId || this.config?.deviceId || 'unknown',
    };
    this.pendingOperations.push(fullOp);
    // Persist to storage so operations survive service worker restarts
    await this.savePendingOperations();
    console.log('[Cloud] Queued operation:', fullOp.opType, 'pending:', this.pendingOperations.length);
  }

  // Register handler for incoming sync operations
  onSync(handler: (ops: SyncOperation[]) => void): void {
    this.syncHandlers.push(handler);
  }

  // Refresh config from storage (call after user saves new credentials)
  async refreshConfig(): Promise<void> {
    this.config = await getConfig();
    console.log('[Cloud] Config refreshed, configured:', this.isConfigured());
  }

  // Perform sync with cloud
  async sync(): Promise<SyncResult> {
    // Always re-read config to pick up any changes from popup
    await this.refreshConfig();

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

      // Clear pending operations that were sent (from memory AND storage)
      await this.clearPendingOperations();

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

  // Check for extension updates
  async checkForUpdate(): Promise<UpdateInfo> {
    try {
      const response = await fetch(CLOUD_CONFIG.versionUrl);
      if (!response.ok) {
        throw new Error(`Version check failed: ${response.status}`);
      }

      const data = await response.json();
      const latestVersion = data.version;
      const currentVersion = EXTENSION_VERSION;

      // Compare versions (simple string comparison works for semver)
      const updateAvailable = this.compareVersions(latestVersion, currentVersion) > 0;

      return {
        updateAvailable,
        currentVersion,
        latestVersion,
        downloadUrl: CLOUD_CONFIG.downloadUrl,
      };
    } catch (err) {
      console.error('[Cloud] Version check error:', err);
      return {
        updateAvailable: false,
        currentVersion: EXTENSION_VERSION,
        latestVersion: EXTENSION_VERSION,
        downloadUrl: CLOUD_CONFIG.downloadUrl,
      };
    }
  }

  // Compare semantic versions, returns: 1 if a > b, -1 if a < b, 0 if equal
  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (numA > numB) return 1;
      if (numA < numB) return -1;
    }
    return 0;
  }

  // Get current version
  getCurrentVersion(): string {
    return EXTENSION_VERSION;
  }
}
