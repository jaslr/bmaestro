export const CLOUD_CONFIG = {
  syncUrl: 'https://bmaestro-sync.fly.dev/sync',
  activityUrl: 'https://bmaestro-sync.fly.dev/activity',
  versionUrl: 'https://bmaestro-sync.fly.dev/version',
  downloadUrl: 'https://bmaestro-sync.fly.dev/download',
  clearUrl: 'https://bmaestro-sync.fly.dev/clear-operations',
  defaultPollIntervalMinutes: 5,
  minPollIntervalMinutes: 1,
  maxPollIntervalMinutes: 60,
};

// Current extension version - must match manifest.json
export const EXTENSION_VERSION = '1.10.33';

export interface StoredConfig {
  syncSecret: string;
  userId: string;
  deviceId: string;
  pollIntervalMinutes: number;
  lastSyncVersion: number;
  lastSyncTime: string | null;
}

export async function getConfig(): Promise<StoredConfig> {
  const result = await chrome.storage.local.get([
    'syncSecret',
    'userId',
    'deviceId',
    'pollIntervalMinutes',
    'lastSyncVersion',
    'lastSyncTime',
  ]);

  return {
    syncSecret: result.syncSecret || '',
    userId: result.userId || '',
    // Don't generate default here - let initialize() handle it so it gets persisted
    deviceId: result.deviceId || '',
    pollIntervalMinutes: result.pollIntervalMinutes || CLOUD_CONFIG.defaultPollIntervalMinutes,
    lastSyncVersion: result.lastSyncVersion || 0,
    lastSyncTime: result.lastSyncTime || null,
  };
}

export async function saveConfig(config: Partial<StoredConfig>): Promise<void> {
  await chrome.storage.local.set(config);
}
