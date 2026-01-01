// packages/extension/src/popup.ts
import { checkForUpdate } from './updater.js';
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
        'isCanonical',
        'preUpdateVersion',
      ]);

      // Check if we just tried to update but version didn't change
      if (stored.preUpdateVersion && stored.preUpdateVersion === EXTENSION_VERSION) {
        // Update didn't work - auto-updater probably hasn't downloaded yet
        showNotification('Update pending - auto-updater will download shortly. Try again in 2 min.', 'info');
        await chrome.storage.local.remove('preUpdateVersion');
      } else if (stored.preUpdateVersion) {
        // Update worked! Clear the flag
        await chrome.storage.local.remove('preUpdateVersion');
      }
      console.log('[Popup] Loaded config:', { userId: stored.userId ? 'set' : 'not set', syncSecret: stored.syncSecret ? 'set' : 'not set', isCanonical: stored.isCanonical });
    } catch (err) {
      console.error('[Popup] Failed to load config:', err);
    }

    // Canonical toggle
    const canonicalToggle = document.getElementById('canonicalToggle') as HTMLInputElement | null;
    if (canonicalToggle) {
      canonicalToggle.checked = stored.isCanonical === true;

      canonicalToggle.addEventListener('change', async () => {
        const wantsCanonical = canonicalToggle.checked;

        try {
          if (wantsCanonical && stored.userId && stored.syncSecret) {
            // Check if another browser already has Source of Truth
            const checkResponse = await fetch('https://bmaestro-sync.fly.dev/canonical', {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${stored.syncSecret}`,
                'X-User-Id': stored.userId,
              },
            });

            if (checkResponse.ok) {
              const data = await checkResponse.json();
              if (data.canonicalBrowser && data.canonicalBrowser !== 'none') {
                const confirmed = confirm(
                  `Another browser (${data.canonicalBrowser}) is currently the Source of Truth.\n\n` +
                  `Take over control from ${data.canonicalBrowser}?`
                );
                if (!confirmed) {
                  canonicalToggle.checked = false;
                  return;
                }
              }
            }
          }

          await chrome.storage.local.set({ isCanonical: wantsCanonical });

          // Notify the cloud about canonical status
          if (stored.userId && stored.syncSecret) {
            await fetch('https://bmaestro-sync.fly.dev/canonical', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${stored.syncSecret}`,
                'X-User-Id': stored.userId,
                'X-Browser-Type': detectBrowser(),
              },
              body: JSON.stringify({ isCanonical: wantsCanonical }),
            });
          }

          showNotification(wantsCanonical ? 'Set as Source of Truth' : 'Removed Source of Truth status', 'success');

          // If becoming canonical, load pending deletions
          if (wantsCanonical) {
            loadModerations();
          }
        } catch (err: any) {
          console.error('[Popup] Set canonical error:', err);
          showNotification(`Failed: ${err.message}`, 'error');
          canonicalToggle.checked = !wantsCanonical; // Revert
        }
      });
    }

    // Detect browser type for header
    function detectBrowser(): string {
      const ua = navigator.userAgent;
      if (ua.includes('Brave')) return 'brave';
      if (ua.includes('Edg/')) return 'edge';
      return 'chrome';
    }

    // Tab switching
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.getAttribute('data-tab');

        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        document.getElementById(`${tabName}Tab`)?.classList.add('active');

        if (tabName === 'moderation') {
          loadModerations();
        }
      });
    });

    // Moderation functions
    const moderationBadge = document.getElementById('moderationBadge');
    const moderationList = document.getElementById('moderationList');
    const moderationActions = document.getElementById('moderationActions');

    async function loadModerations(): Promise<void> {
      if (!stored.userId || !stored.syncSecret) return;

      try {
        const response = await fetch('https://bmaestro-sync.fly.dev/moderation/pending', {
          headers: {
            'Authorization': `Bearer ${stored.syncSecret}`,
            'X-User-Id': stored.userId,
          },
        });

        if (!response.ok) {
          if (moderationList) {
            moderationList.innerHTML = '<div class="moderation-empty">Failed to load</div>';
          }
          return;
        }

        const data = await response.json();
        const items = data.items || [];

        // Update badge
        if (moderationBadge) {
          if (items.length > 0) {
            moderationBadge.textContent = String(items.length);
            moderationBadge.classList.remove('hidden');
          } else {
            moderationBadge.classList.add('hidden');
          }
        }

        // Update list
        if (moderationList) {
          if (items.length === 0) {
            moderationList.innerHTML = '<div class="moderation-empty">No pending deletions</div>';
          } else {
            moderationList.innerHTML = items.map((item: any) => `
              <div class="moderation-item" data-id="${item.id}">
                <div class="moderation-info">
                  <span class="moderation-title">${escapeHtml(item.title || 'Untitled')}</span>
                  <span class="moderation-meta">
                    Deleted by <span class="browser">${item.browser || 'unknown'}</span>
                    ${item.url ? ` · ${truncateUrl(item.url)}` : ''}
                  </span>
                </div>
                <div class="moderation-btns">
                  <button class="btn small mod-accept" data-id="${item.id}">Accept</button>
                  <button class="btn small warning mod-reject" data-id="${item.id}">Reject</button>
                </div>
              </div>
            `).join('');

            // Attach event listeners (CSP-compliant)
            moderationList.querySelectorAll('.mod-accept').forEach(btn => {
              btn.addEventListener('click', () => {
                const id = (btn as HTMLElement).dataset.id!;
                handleModeration(id, 'accept');
              });
            });
            moderationList.querySelectorAll('.mod-reject').forEach(btn => {
              btn.addEventListener('click', () => {
                const id = (btn as HTMLElement).dataset.id!;
                handleModeration(id, 'reject');
              });
            });
          }
        }

        // Show/hide bulk actions
        if (moderationActions) {
          if (items.length > 1) {
            moderationActions.classList.remove('hidden');
          } else {
            moderationActions.classList.add('hidden');
          }
        }
      } catch (err) {
        console.error('[Popup] Load moderation error:', err);
        if (moderationList) {
          moderationList.innerHTML = '<div class="moderation-empty">Error loading</div>';
        }
      }
    }

    function escapeHtml(text: string): string {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function truncateUrl(url: string): string {
      try {
        const u = new URL(url);
        return u.hostname.replace('www.', '');
      } catch {
        return url.substring(0, 20) + '...';
      }
    }

    // Handler for moderation buttons
    async function handleModeration(id: string, action: 'accept' | 'reject') {
      try {
        const response = await fetch(`https://bmaestro-sync.fly.dev/moderation/${id}/${action}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stored.syncSecret}`,
            'X-User-Id': stored.userId,
          },
        });

        if (response.ok) {
          const result = await response.json();
          const item = result.deleted || result.rejected;

          if (action === 'accept' && item?.url) {
            // Check if bookmark exists locally and delete it
            const existing = await chrome.bookmarks.search({ url: item.url });
            if (existing.length > 0) {
              for (const bookmark of existing) {
                await chrome.bookmarks.remove(bookmark.id);
              }
              showNotification(`Deleted "${item.title || 'bookmark'}" from this browser`, 'success');
            } else {
              showNotification(`Accepted (wasn't in this browser)`, 'info');
            }
          } else if (action === 'reject') {
            showNotification(`Rejected - bookmark will stay`, 'success');
            // Trigger sync to restore bookmark in the other browser
            chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
          }

          loadModerations();
        } else {
          showNotification(`Failed to ${action}`, 'error');
        }
      } catch (err: any) {
        showNotification(`Error: ${err.message}`, 'error');
      }
    }

    // Accept all / Reject all
    const acceptAllBtn = document.getElementById('acceptAll') as HTMLButtonElement | null;
    const rejectAllBtn = document.getElementById('rejectAll') as HTMLButtonElement | null;

    if (acceptAllBtn) {
      acceptAllBtn.addEventListener('click', async () => {
        if (!confirm('Accept all pending deletions?')) return;

        try {
          const response = await fetch('https://bmaestro-sync.fly.dev/moderation/accept-all', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${stored.syncSecret}`,
              'X-User-Id': stored.userId,
            },
          });

          if (response.ok) {
            showNotification('All deletions accepted', 'success');
            loadModerations();
          }
        } catch (err: any) {
          showNotification(`Error: ${err.message}`, 'error');
        }
      });
    }

    if (rejectAllBtn) {
      rejectAllBtn.addEventListener('click', async () => {
        if (!confirm('Reject all pending deletions? Bookmarks will be restored.')) return;

        try {
          const response = await fetch('https://bmaestro-sync.fly.dev/moderation/reject-all', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${stored.syncSecret}`,
              'X-User-Id': stored.userId,
            },
          });

          if (response.ok) {
            showNotification('All deletions rejected', 'success');
            loadModerations();
            chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
          }
        } catch (err: any) {
          showNotification(`Error: ${err.message}`, 'error');
        }
      });
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

    // Clean duplicates button
    const cleanDuplicatesBtn = document.getElementById('cleanDuplicates') as HTMLButtonElement | null;
    if (cleanDuplicatesBtn) {
      cleanDuplicatesBtn.addEventListener('click', async () => {
        console.log('[Popup] Clean duplicates clicked');

        if (!confirm('This will remove duplicate bookmarks (keeping one copy of each URL). Continue?')) {
          return;
        }

        cleanDuplicatesBtn.disabled = true;
        cleanDuplicatesBtn.textContent = 'Cleaning...';

        try {
          console.log('[Popup] Sending CLEAN_DUPLICATES message...');
          const response = await chrome.runtime.sendMessage({ type: 'CLEAN_DUPLICATES' });
          console.log('[Popup] Clean duplicates response:', response);

          if (response?.success) {
            showNotification(`Removed ${response.removed} duplicates, kept ${response.kept} bookmarks`, 'success');
          } else {
            const errorMsg = response?.error || 'Unknown error';
            console.error('[Popup] Cleanup failed:', errorMsg);
            showNotification(`Cleanup failed: ${errorMsg}`, 'error');
          }
        } catch (err: any) {
          console.error('[Popup] Clean duplicates error:', err);
          showNotification(`Cleanup failed: ${err.message || err}`, 'error');
        }

        cleanDuplicatesBtn.disabled = false;
        cleanDuplicatesBtn.textContent = 'Clean Duplicates';
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

    // Update now button - reloads extension (auto-updater handles file download)
    if (updateNowBtn && updateBanner) {
      updateNowBtn.addEventListener('click', async () => {
        console.log('[Popup] Update now clicked');
        updateNowBtn.disabled = true;
        updateNowBtn.textContent = 'Reloading...';

        // Store current version to check if update worked
        await chrome.storage.local.set({ preUpdateVersion: EXTENSION_VERSION });

        // Reload the extension - auto-updater should have downloaded new files
        chrome.runtime.reload();
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

    // Load activity and moderation badge on init if configured
    if (stored.userId && stored.syncSecret) {
      loadActivity();
      // Always load moderation count for badge
      loadModerations();
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
