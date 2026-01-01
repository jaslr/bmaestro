// packages/extension/src/updater.ts
// Extension update checker and downloader

import { CLOUD_CONFIG, EXTENSION_VERSION } from './cloud/config.js';

interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
}

// Check for updates
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const response = await fetch(CLOUD_CONFIG.versionUrl);
    const data = await response.json();

    const updateAvailable = compareVersions(data.version, EXTENSION_VERSION) > 0;

    return {
      updateAvailable,
      currentVersion: EXTENSION_VERSION,
      latestVersion: data.version,
      downloadUrl: data.downloadUrl || CLOUD_CONFIG.downloadUrl,
    };
  } catch (error) {
    console.error('[Updater] Failed to check for update:', error);
    return {
      updateAvailable: false,
      currentVersion: EXTENSION_VERSION,
      latestVersion: EXTENSION_VERSION,
      downloadUrl: CLOUD_CONFIG.downloadUrl,
    };
  }
}

function compareVersions(a: string, b: string): number {
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

// Download and run the installer
export async function downloadUpdate(): Promise<void> {
  // Download a self-contained installer that extracts to the right place
  const downloadId = await chrome.downloads.download({
    url: `${CLOUD_CONFIG.downloadUrl}/install.cmd`,
    filename: 'bmaestro-update.cmd',
    saveAs: false,
  });

  // Open the downloads folder after a short delay
  setTimeout(() => {
    chrome.downloads.showDefaultFolder();
  }, 1000);
}

// These are no longer used but kept for backwards compatibility
export async function setupAutoUpdate(): Promise<boolean> {
  // File System Access API not available in extension popups
  // Just download the update instead
  await downloadUpdate();
  return true;
}

export async function isAutoUpdateConfigured(): Promise<boolean> {
  // Always return false - we use manual download now
  return false;
}

export async function downloadAndApplyUpdate(
  onProgress?: (status: string) => void
): Promise<boolean> {
  onProgress?.('Downloading update...');
  await downloadUpdate();
  onProgress?.('Download started - check your downloads folder');
  return true;
}
