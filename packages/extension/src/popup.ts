// packages/extension/src/popup.ts
import type { CloudClient } from './cloud/client.js';

interface BmaestroGlobals {
  bmaestroClient: CloudClient;
}

async function init(): Promise<void> {
  // Get references from background page
  const bg = await chrome.runtime.getBackgroundPage() as unknown as BmaestroGlobals | null;

  if (!bg?.bmaestroClient) {
    // Service worker context - need to use messaging
    console.log('[Popup] Using messaging API');
    initWithMessaging();
    return;
  }

  const client = bg.bmaestroClient;

  // UI elements
  const versionEl = document.getElementById('version')!;
  const updateBanner = document.getElementById('updateBanner')!;
  const newVersionEl = document.getElementById('newVersion')!;
  const updateLink = document.getElementById('updateLink') as HTMLAnchorElement;
  const statusEl = document.getElementById('status')!;
  const lastSyncEl = document.getElementById('lastSync')!;
  const pendingEl = document.getElementById('pending')!;
  const syncNowBtn = document.getElementById('syncNow') as HTMLButtonElement;
  const intervalSelect = document.getElementById('interval') as HTMLSelectElement;
  const configSection = document.getElementById('configSection')!;
  const userIdInput = document.getElementById('userId') as HTMLInputElement;
  const syncSecretInput = document.getElementById('syncSecret') as HTMLInputElement;
  const saveConfigBtn = document.getElementById('saveConfig') as HTMLButtonElement;

  // Show current version
  versionEl.textContent = `v${client.getCurrentVersion()}`;

  // Check for updates
  async function checkForUpdates(): Promise<void> {
    const updateInfo = await client.checkForUpdate();
    if (updateInfo.updateAvailable) {
      newVersionEl.textContent = `v${updateInfo.latestVersion}`;
      updateLink.href = updateInfo.downloadUrl;
      updateBanner.classList.remove('hidden');
    }
  }
  checkForUpdates();

  // Update status display
  function updateStatus(): void {
    const status = client.getStatus();

    if (!status.configured) {
      statusEl.textContent = 'Not configured';
      statusEl.className = 'value disconnected';
      configSection.classList.remove('hidden');
    } else {
      statusEl.textContent = 'Ready';
      statusEl.className = 'value connected';
      configSection.classList.add('hidden');
    }

    if (status.lastSync) {
      const lastSync = new Date(status.lastSync);
      const now = new Date();
      const diffMs = now.getTime() - lastSync.getTime();
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) {
        lastSyncEl.textContent = 'Just now';
      } else if (diffMins < 60) {
        lastSyncEl.textContent = `${diffMins} min ago`;
      } else {
        lastSyncEl.textContent = lastSync.toLocaleTimeString();
      }
    } else {
      lastSyncEl.textContent = 'Never';
    }

    pendingEl.textContent = `${status.pendingOps} operations`;
  }

  // Initial status
  updateStatus();

  // Load current interval
  const currentInterval = await client.getPollInterval();
  intervalSelect.value = String(currentInterval);

  // Sync now button
  syncNowBtn.addEventListener('click', async () => {
    syncNowBtn.disabled = true;
    syncNowBtn.textContent = 'Syncing...';
    statusEl.textContent = 'Syncing...';
    statusEl.className = 'value syncing';

    try {
      const result = await client.sync();
      if (result.success) {
        statusEl.textContent = 'Sync complete';
        statusEl.className = 'value connected';
      } else {
        statusEl.textContent = result.error || 'Sync failed';
        statusEl.className = 'value disconnected';
      }
    } catch (err) {
      statusEl.textContent = 'Sync failed';
      statusEl.className = 'value disconnected';
    }

    syncNowBtn.disabled = false;
    syncNowBtn.textContent = 'Sync Now';
    updateStatus();
  });

  // Interval change
  intervalSelect.addEventListener('change', async () => {
    const minutes = parseInt(intervalSelect.value);
    await client.setPollInterval(minutes);

    // Update alarm
    await chrome.alarms.clear('bmaestro-sync');
    chrome.alarms.create('bmaestro-sync', {
      delayInMinutes: minutes,
      periodInMinutes: minutes,
    });
  });

  // Save config
  saveConfigBtn.addEventListener('click', async () => {
    const userId = userIdInput.value.trim();
    const syncSecret = syncSecretInput.value.trim();

    if (!userId || !syncSecret) {
      alert('Please enter both User ID and Sync Secret');
      return;
    }

    await chrome.storage.local.set({ userId, syncSecret });

    // Reinitialize client
    await client.initialize();
    updateStatus();

    // Trigger initial sync
    syncNowBtn.click();
  });

  // Refresh status periodically
  setInterval(updateStatus, 5000);
}

// Fallback for service worker context
function initWithMessaging(): void {
  // For Manifest V3 service workers, we need to use messaging
  // This is a simplified version - full implementation would use chrome.runtime.sendMessage

  const statusEl = document.getElementById('status')!;
  statusEl.textContent = 'Service Worker Mode';

  const syncNowBtn = document.getElementById('syncNow') as HTMLButtonElement;
  syncNowBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
  });
}

document.addEventListener('DOMContentLoaded', init);
