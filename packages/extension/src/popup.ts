// packages/extension/src/popup.ts
import { checkForUpdate, downloadUpdate } from './updater.js';
import { EXTENSION_VERSION } from './cloud/config.js';

// Show notification in the popup
function showNotification(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();

  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;

  const popup = document.querySelector('.popup');
  if (popup) {
    popup.insertBefore(notification, popup.firstChild?.nextSibling || null);
  }

  // Auto-dismiss after 4 seconds
  setTimeout(() => notification.remove(), 4000);
}

async function init(): Promise<void> {
  console.log('[Popup] Initializing...');

  try {
    // UI elements
    const versionEl = document.getElementById('version');
    const updateBanner = document.getElementById('updateBanner');
    const newVersionEl = document.getElementById('newVersion');
    const updateNowBtn = document.getElementById('updateNow') as HTMLButtonElement | null;
        const statusEl = document.getElementById('status');
    const lastSyncEl = document.getElementById('lastSync');
    const pendingEl = document.getElementById('pending');
    const syncNowBtn = document.getElementById('syncNow') as HTMLButtonElement | null;
    const intervalSelect = document.getElementById('interval') as HTMLSelectElement | null;
    const configSection = document.getElementById('configSection');
    const userIdInput = document.getElementById('userId') as HTMLInputElement | null;
    const syncSecretInput = document.getElementById('syncSecret') as HTMLInputElement | null;
    const saveConfigBtn = document.getElementById('saveConfig') as HTMLButtonElement | null;
    
    // Show current version
    if (versionEl) {
      versionEl.textContent = `v${EXTENSION_VERSION}`;
    }

    // Load stored config first
    let stored: Record<string, any> = {};
    try {
      stored = await chrome.storage.local.get([
        'userId',
        'syncSecret',
        'pollIntervalMinutes',
        'lastSyncTime',
        'pendingOps',
      ]);
      console.log('[Popup] Loaded config:', { userId: stored.userId ? 'set' : 'not set', syncSecret: stored.syncSecret ? 'set' : 'not set' });
    } catch (err) {
      console.error('[Popup] Failed to load config:', err);
    }

    // Update status display
    function updateStatusDisplay(): void {
      const hasConfig = stored.userId && stored.syncSecret;

      if (statusEl) {
        if (!hasConfig) {
          statusEl.textContent = 'Not configured';
          statusEl.className = 'value disconnected';
        } else {
          statusEl.textContent = 'Ready';
          statusEl.className = 'value connected';
        }
      }

      if (configSection) {
        if (!hasConfig) {
          configSection.classList.remove('hidden');
        } else {
          configSection.classList.add('hidden');
        }
      }

      if (lastSyncEl) {
        if (stored.lastSyncTime) {
          const lastSync = new Date(stored.lastSyncTime);
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
      }

      if (pendingEl) {
        pendingEl.textContent = `${stored.pendingOps?.length || 0} operations`;
      }
    }

    updateStatusDisplay();

    // Load current interval
    if (intervalSelect) {
      intervalSelect.value = String(stored.pollIntervalMinutes || 5);
    }

    // Save config button
    if (saveConfigBtn && userIdInput && syncSecretInput) {
      saveConfigBtn.addEventListener('click', async () => {
        console.log('[Popup] Save config clicked');
        const userId = userIdInput.value.trim();
        const syncSecret = syncSecretInput.value.trim();

        if (!userId || !syncSecret) {
          showNotification('Please enter both User ID and Sync Secret', 'error');
          return;
        }

        try {
          saveConfigBtn.disabled = true;
          saveConfigBtn.textContent = 'Saving...';

          await chrome.storage.local.set({ userId, syncSecret });
          stored.userId = userId;
          stored.syncSecret = syncSecret;

          showNotification('Configuration saved!', 'success');
          updateStatusDisplay();

          // Trigger initial sync
          if (syncNowBtn) {
            syncNowBtn.click();
          }
        } catch (err: any) {
          console.error('[Popup] Save config error:', err);
          showNotification(`Save failed: ${err.message}`, 'error');
        } finally {
          saveConfigBtn.disabled = false;
          saveConfigBtn.textContent = 'Save Configuration';
        }
      });
    }

    // Sync now button
    if (syncNowBtn) {
      syncNowBtn.addEventListener('click', async () => {
        console.log('[Popup] Sync now clicked');

        if (!stored.userId || !stored.syncSecret) {
          showNotification('Please configure User ID and Sync Secret first', 'error');
          return;
        }

        syncNowBtn.disabled = true;
        syncNowBtn.textContent = 'Syncing...';
        if (statusEl) {
          statusEl.textContent = 'Syncing...';
          statusEl.className = 'value syncing';
        }

        try {
          const response = await chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
          console.log('[Popup] Sync response:', response);

          if (response?.success) {
            showNotification('Sync complete!', 'success');
            if (statusEl) {
              statusEl.textContent = 'Sync complete';
              statusEl.className = 'value connected';
            }
          } else {
            showNotification(response?.error || 'Sync failed', 'error');
            if (statusEl) {
              statusEl.textContent = 'Sync failed';
              statusEl.className = 'value disconnected';
            }
          }

          // Refresh stored data
          const newStored = await chrome.storage.local.get(['lastSyncTime', 'pendingOps']);
          stored.lastSyncTime = newStored.lastSyncTime;
          stored.pendingOps = newStored.pendingOps;
          updateStatusDisplay();
          loadActivity();
        } catch (err: any) {
          console.error('[Popup] Sync error:', err);
          showNotification(`Sync failed: ${err.message}`, 'error');
          if (statusEl) {
            statusEl.textContent = 'Sync failed';
            statusEl.className = 'value disconnected';
          }
        }

        syncNowBtn.disabled = false;
        syncNowBtn.textContent = 'Sync Changes';
      });
    }

    // Full sync button
    const fullSyncBtn = document.getElementById('fullSync') as HTMLButtonElement | null;
    if (fullSyncBtn) {
      fullSyncBtn.addEventListener('click', async () => {
        console.log('[Popup] Full sync clicked');

        if (!stored.userId || !stored.syncSecret) {
          showNotification('Please configure User ID and Sync Secret first', 'error');
          return;
        }

        if (!confirm('This will upload ALL your bookmarks to the cloud. Continue?')) {
          return;
        }

        fullSyncBtn.disabled = true;
        fullSyncBtn.textContent = 'Exporting...';
        if (statusEl) {
          statusEl.textContent = 'Full sync...';
          statusEl.className = 'value syncing';
        }

        try {
          const response = await chrome.runtime.sendMessage({ type: 'FULL_SYNC' });
          console.log('[Popup] Full sync response:', response);

          if (response?.success) {
            showNotification(`Exported ${response.count} bookmarks!`, 'success');
            if (statusEl) {
              statusEl.textContent = 'Sync complete';
              statusEl.className = 'value connected';
            }
          } else {
            showNotification(response?.error || 'Full sync failed', 'error');
            if (statusEl) {
              statusEl.textContent = 'Sync failed';
              statusEl.className = 'value disconnected';
            }
          }

          // Refresh stored data
          const newStored = await chrome.storage.local.get(['lastSyncTime', 'pendingOps']);
          stored.lastSyncTime = newStored.lastSyncTime;
          stored.pendingOps = newStored.pendingOps;
          updateStatusDisplay();
          loadActivity();
        } catch (err: any) {
          console.error('[Popup] Full sync error:', err);
          showNotification(`Full sync failed: ${err.message}`, 'error');
          if (statusEl) {
            statusEl.textContent = 'Sync failed';
            statusEl.className = 'value disconnected';
          }
        }

        fullSyncBtn.disabled = false;
        fullSyncBtn.textContent = 'Full Sync (Export All)';
      });
    }

    // Interval change
    if (intervalSelect) {
      intervalSelect.addEventListener('change', async () => {
        const minutes = parseInt(intervalSelect.value);
        try {
          await chrome.storage.local.set({ pollIntervalMinutes: minutes });
          await chrome.alarms.clear('bmaestro-sync');
          chrome.alarms.create('bmaestro-sync', {
            delayInMinutes: minutes,
            periodInMinutes: minutes,
          });
          showNotification(`Sync interval set to ${minutes} minutes`, 'info');
        } catch (err: any) {
          console.error('[Popup] Set interval error:', err);
          showNotification(`Failed to set interval: ${err.message}`, 'error');
        }
      });
    }

    // Update now button - downloads update zip
    if (updateNowBtn && updateBanner) {
      updateNowBtn.addEventListener('click', async () => {
        console.log('[Popup] Update now clicked');
        try {
          updateNowBtn.disabled = true;
          updateNowBtn.textContent = 'Downloading...';
          await downloadUpdate();
          showNotification('Download started - extract zip and reload extension', 'success');
        } catch (err: any) {
          console.error('[Popup] Update error:', err);
          showNotification(`Download failed: ${err.message}`, 'error');
        } finally {
          updateNowBtn.disabled = false;
          updateNowBtn.textContent = 'Download Update';
        }
      });
    }

    // Check for updates (don't let this block other functionality)
    if (updateBanner && newVersionEl) {
      checkForUpdate()
        .then((updateInfo) => {
          if (updateInfo.updateAvailable) {
            newVersionEl.textContent = `v${updateInfo.latestVersion}`;
            updateBanner.classList.remove('hidden');
            // Show reload button in header
            if (reloadExtensionBtn) {
              reloadExtensionBtn.classList.remove('hidden');
            }
          }
        })
        .catch((err) => {
          console.error('[Popup] Check update error:', err);
        });
    }

    // Activity section
    const activityList = document.getElementById('activityList');
    const refreshActivityBtn = document.getElementById('refreshActivity') as HTMLButtonElement | null;

    async function loadActivity(): Promise<void> {
      if (!activityList || !stored.userId || !stored.syncSecret) return;

      try {
        const response = await fetch(
          `https://bmaestro-sync.fly.dev/activity?limit=10`,
          {
            headers: {
              'Authorization': `Bearer ${stored.syncSecret}`,
              'X-User-Id': stored.userId,
            },
          }
        );

        if (!response.ok) {
          activityList.innerHTML = '<div class="activity-empty">Failed to load</div>';
          return;
        }

        const data = await response.json();

        if (!data.items || data.items.length === 0) {
          activityList.innerHTML = '<div class="activity-empty">No activity yet</div>';
          return;
        }

        activityList.innerHTML = data.items.map((item: any) => {
          const time = new Date(item.timestamp).toLocaleTimeString();
          const action = item.action.replace('BOOKMARK_', '').replace('SYNC_', '').toLowerCase();
          const title = item.bookmark_title || item.action;
          const browser = item.browser_type || '';

          return `<div class="activity-item">
            <span class="activity-action">${action}</span>
            <span class="activity-title">${title}</span>
            <span class="activity-meta">${browser} · ${time}</span>
          </div>`;
        }).join('');
      } catch (err) {
        console.error('[Popup] Load activity error:', err);
        activityList.innerHTML = '<div class="activity-empty">Error loading activity</div>';
      }
    }

    if (refreshActivityBtn) {
      refreshActivityBtn.addEventListener('click', () => {
        loadActivity();
        showNotification('Activity refreshed', 'info');
      });
    }

    // Load activity on init if configured
    if (stored.userId && stored.syncSecret) {
      loadActivity();
    }

    // Reload Extension button (shown only when update available)
    const reloadExtensionBtn = document.getElementById('reloadExtension') as HTMLButtonElement | null;
    if (reloadExtensionBtn) {
      reloadExtensionBtn.addEventListener('click', () => {
        console.log('[Popup] Reload extension clicked');
        chrome.runtime.reload();
      });
    }

    // Settings menu
    const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement | null;
    const settingsMenu = document.getElementById('settingsMenu');
    const logoutBtn = document.getElementById('logoutBtn') as HTMLButtonElement | null;

    if (settingsBtn && settingsMenu) {
      settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('hidden');
      });

      // Close menu when clicking outside
      document.addEventListener('click', () => {
        settingsMenu.classList.add('hidden');
      });

      settingsMenu.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        if (confirm('Clear all configuration and logout?')) {
          try {
            await chrome.storage.local.clear();
            stored = {};
            showNotification('Logged out successfully', 'success');
            updateStatusDisplay();
            if (settingsMenu) settingsMenu.classList.add('hidden');
          } catch (err: any) {
            showNotification(`Logout failed: ${err.message}`, 'error');
          }
        }
      });
    }

    // Refresh status periodically
    setInterval(async () => {
      try {
        const newStored = await chrome.storage.local.get(['lastSyncTime', 'pendingOps']);
        stored.lastSyncTime = newStored.lastSyncTime;
        stored.pendingOps = newStored.pendingOps;
        updateStatusDisplay();
      } catch (err) {
        console.error('[Popup] Refresh status error:', err);
      }
    }, 5000);

    console.log('[Popup] Initialization complete');

  } catch (err) {
    console.error('[Popup] Init error:', err);
    showNotification(`Initialization error: ${err}`, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => {
    console.error('[Popup] Fatal init error:', err);
  });
});
