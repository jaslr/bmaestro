// packages/extension/src/popup.ts
import { EXTENSION_VERSION } from './cloud/config.js';
import { CLOUD_CONFIG } from './cloud/config.js';

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
    const statusEl = document.getElementById('status');
    const lastSyncEl = document.getElementById('lastSync');
    const pendingEl = document.getElementById('pending');
    const syncNowBtn = document.getElementById('syncNow') as HTMLButtonElement | null;
    const intervalSelect = document.getElementById('interval') as HTMLSelectElement | null;
    const configSection = document.getElementById('configSection');
    const userIdInput = document.getElementById('userId') as HTMLInputElement | null;
    const syncSecretInput = document.getElementById('syncSecret') as HTMLInputElement | null;
    const saveConfigBtn = document.getElementById('saveConfig') as HTMLButtonElement | null;
    
    // Show current version in header and menu
    if (versionEl) {
      versionEl.textContent = `v${EXTENSION_VERSION}`;
    }
    const menuVersionEl = document.getElementById('menuVersion');
    if (menuVersionEl) {
      menuVersionEl.textContent = `v${EXTENSION_VERSION}`;
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
      ]);
      console.log('[Popup] Loaded config:', { userId: stored.userId ? 'set' : 'not set', syncSecret: stored.syncSecret ? 'set' : 'not set', isCanonical: stored.isCanonical });
    } catch (err) {
      console.error('[Popup] Failed to load config:', err);
    }

    // Show alert banner if there's a badge reason, then clear badge
    const alertBanner = document.getElementById('alertBanner');
    const alertText = document.getElementById('alertText');
    const dismissAlert = document.getElementById('dismissAlert');

    try {
      const { badgeReason, badgeType } = await chrome.storage.local.get(['badgeReason', 'badgeType']);
      if (badgeReason && alertBanner && alertText) {
        alertText.textContent = badgeReason;
        alertBanner.classList.remove('hidden');
        if (badgeType === 'error') {
          alertBanner.classList.add('error');
        }
        // Clear the badge since user has now seen it
        chrome.action.setBadgeText({ text: '' });
        await chrome.storage.local.remove(['badgeReason', 'badgeType']);
      }
    } catch (err) {
      console.error('[Popup] Failed to check badge status:', err);
    }

    // Dismiss alert button
    if (dismissAlert && alertBanner) {
      dismissAlert.addEventListener('click', () => {
        alertBanner.classList.add('hidden');
      });
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
            moderationList.innerHTML = '<div class="moderation-empty">No pending operations</div>';
          } else {
            moderationList.innerHTML = items.map((item: any) => {
              const opType = item.operationType || 'DELETE';
              const actionVerb = opType === 'ADD' ? 'Added by' : opType === 'UPDATE' ? 'Updated by' : 'Deleted by';
              const folderInfo = item.folderPath ? ` · ${item.folderPath}` : '';

              return `
              <div class="moderation-item" data-id="${item.id}" data-op-type="${opType}">
                <div class="moderation-info">
                  <span class="moderation-title">${opType}: ${escapeHtml(item.title || 'Untitled')}</span>
                  <span class="moderation-meta">
                    ${actionVerb} <span class="browser">${item.browser || 'unknown'}</span>
                    ${item.url ? ` · ${truncateUrl(item.url)}` : ''}${folderInfo}
                  </span>
                </div>
                <div class="moderation-btns">
                  <button class="btn small mod-accept" data-id="${item.id}" data-op-type="${opType}">Accept</button>
                  <button class="btn small warning mod-reject" data-id="${item.id}" data-op-type="${opType}">Reject</button>
                </div>
              </div>
            `;
            }).join('');

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
          const item = result.accepted || result.rejected;
          const opType = result.operationType || item?.operationType || 'DELETE';

          if (action === 'accept') {
            // Handle accept based on operation type
            if (opType === 'DELETE' && item?.url) {
              // Delete: remove bookmark locally
              const existing = await chrome.bookmarks.search({ url: item.url });
              if (existing.length > 0) {
                for (const bookmark of existing) {
                  await chrome.bookmarks.remove(bookmark.id);
                }
                showNotification(`Deleted "${item.title || 'bookmark'}" from this browser`, 'success');
              } else {
                showNotification(`Accepted deletion (wasn't in this browser)`, 'info');
              }
            } else if (opType === 'ADD') {
              // Add: trigger sync to add bookmark to this browser
              showNotification(`Accepted "${item?.title || 'bookmark'}" - syncing...`, 'success');
              chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
            } else if (opType === 'UPDATE') {
              // Update: trigger sync to apply update
              showNotification(`Accepted update to "${item?.title || 'bookmark'}" - syncing...`, 'success');
              chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
            }
          } else if (action === 'reject') {
            // Handle reject based on operation type
            if (opType === 'ADD') {
              // Reject ADD: bookmark needs to be deleted from originating browser
              showNotification(`Rejected - bookmark will be removed from ${item?.browser || 'other browser'}`, 'success');
              // Trigger sync to send reversal
              chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
            } else if (opType === 'UPDATE') {
              // Reject UPDATE: change needs to be reverted in originating browser
              showNotification(`Rejected - change will be reverted in ${item?.browser || 'other browser'}`, 'success');
              // Trigger sync to send reversal
              chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
            } else if (opType === 'DELETE') {
              // Reject DELETE: bookmark stays (no action needed)
              showNotification(`Rejected - bookmark will stay`, 'success');
            }
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
        if (!confirm('Accept all pending operations?')) return;

        try {
          const response = await fetch('https://bmaestro-sync.fly.dev/moderation/accept-all', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${stored.syncSecret}`,
              'X-User-Id': stored.userId,
            },
          });

          if (response.ok) {
            const result = await response.json();
            showNotification(`Accepted ${result.count} operations - syncing...`, 'success');
            loadModerations();
            // Trigger sync to apply accepted operations
            chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
          }
        } catch (err: any) {
          showNotification(`Error: ${err.message}`, 'error');
        }
      });
    }

    if (rejectAllBtn) {
      rejectAllBtn.addEventListener('click', async () => {
        if (!confirm('Reject all pending operations? Changes will be reverted.')) return;

        try {
          const response = await fetch('https://bmaestro-sync.fly.dev/moderation/reject-all', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${stored.syncSecret}`,
              'X-User-Id': stored.userId,
            },
          });

          if (response.ok) {
            const result = await response.json();
            showNotification(`Rejected ${result.count} operations - reverting...`, 'success');
            loadModerations();
            // Trigger sync to send reversals
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
        syncNowBtn.textContent = 'Sync Now';
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

    // Reset from Source of Truth button
    const resetFromCanonicalBtn = document.getElementById('resetFromCanonical') as HTMLButtonElement | null;
    // Clear Server Data button (declared here for use in updateButtonVisibility)
    const clearServerDataBtn = document.getElementById('clearServerData') as HTMLButtonElement | null;

    // Show/hide reset button based on canonical status (only show if NOT canonical)
    // Show/hide clear server data button (only show if IS canonical - source of truth)
    function updateButtonVisibility(): void {
      if (resetFromCanonicalBtn) {
        if (stored.isCanonical === true) {
          resetFromCanonicalBtn.classList.add('hidden');
        } else {
          resetFromCanonicalBtn.classList.remove('hidden');
        }
      }
      if (clearServerDataBtn) {
        if (stored.isCanonical === true) {
          clearServerDataBtn.classList.remove('hidden');
        } else {
          clearServerDataBtn.classList.add('hidden');
        }
      }
    }
    updateButtonVisibility();

    // Update button visibility when canonical toggle changes
    if (canonicalToggle) {
      canonicalToggle.addEventListener('change', () => {
        // Update stored value for visibility check
        stored.isCanonical = canonicalToggle.checked;
        updateButtonVisibility();
      });
    }

    if (resetFromCanonicalBtn) {
      resetFromCanonicalBtn.addEventListener('click', async () => {
        console.log('[Popup] Reset from Source of Truth clicked');

        // Double-check this browser is not canonical (shouldn't be visible, but just in case)
        if (stored.isCanonical === true) {
          showNotification('This is the Source of Truth - cannot reset from itself', 'error');
          return;
        }

        if (!confirm('This will DELETE all bookmarks in this browser\'s Bookmarks Bar and re-sync from the Source of Truth.\n\nThis cannot be undone. Continue?')) {
          return;
        }

        resetFromCanonicalBtn.disabled = true;
        resetFromCanonicalBtn.textContent = 'Resetting...';
        if (statusEl) {
          statusEl.textContent = 'Resetting...';
          statusEl.className = 'value syncing';
        }

        try {
          console.log('[Popup] Sending RESET_FROM_CANONICAL message...');
          const response = await chrome.runtime.sendMessage({ type: 'RESET_FROM_CANONICAL' });
          console.log('[Popup] Reset response:', JSON.stringify(response));

          if (!response) {
            console.error('[Popup] No response from background script');
            showNotification('Reset failed: No response from background', 'error');
            if (statusEl) {
              statusEl.textContent = 'Reset failed';
              statusEl.className = 'value disconnected';
            }
          } else if (response.success) {
            const details = response.details ? ` (${response.details})` : '';
            showNotification(`Reset complete! Synced ${response.count || 0} items${details}`, 'success');
            console.log('[Popup] Reset success:', response);
            if (statusEl) {
              statusEl.textContent = 'Sync complete';
              statusEl.className = 'value connected';
            }
          } else {
            const errorMsg = response.error || `Unknown error (response: ${JSON.stringify(response)})`;
            console.error('[Popup] Reset failed:', errorMsg);
            showNotification(`Reset failed: ${errorMsg}`, 'error');
            if (statusEl) {
              statusEl.textContent = 'Reset failed';
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
          console.error('[Popup] Reset from canonical error:', err);
          showNotification(`Reset failed: ${err.message || err}`, 'error');
          if (statusEl) {
            statusEl.textContent = 'Reset failed';
            statusEl.className = 'value disconnected';
          }
        }

        resetFromCanonicalBtn.disabled = false;
        resetFromCanonicalBtn.textContent = 'Reset from Source of Truth';
      });
    }

    // Clear Server Data button event listener
    if (clearServerDataBtn) {
      clearServerDataBtn.addEventListener('click', async () => {
        if (!confirm('This will delete ALL sync operations from the server.\n\nAfter this, you should:\n1. Click "Full Sync (Export All)" in Chrome (Source of Truth)\n2. Click "Reset from Source of Truth" in other browsers\n\nContinue?')) {
          return;
        }

        try {
          clearServerDataBtn.disabled = true;
          clearServerDataBtn.textContent = 'Clearing...';

          const response = await chrome.runtime.sendMessage({ type: 'CLEAR_SERVER_DATA' });

          if (!response) {
            showNotification('Clear failed: No response from background', 'error');
          } else if (response.success) {
            showNotification(`Server cleared! Deleted ${response.deleted} operations. Now do Full Sync from Chrome.`, 'success');
          } else {
            showNotification(`Clear failed: ${response.error || 'Unknown error'}`, 'error');
          }
        } catch (err: any) {
          console.error('[Popup] Clear server data error:', err);
          showNotification(`Clear failed: ${err.message || err}`, 'error');
        }

        clearServerDataBtn.disabled = false;
        clearServerDataBtn.textContent = 'Clear Server Data';
      });
    }

    // Debug export - downloads bookmark structure as JSON file
    const debugExportBtn = document.getElementById('debugExport') as HTMLButtonElement | null;
    if (debugExportBtn) {
      debugExportBtn.addEventListener('click', async () => {
        try {
          debugExportBtn.disabled = true;
          debugExportBtn.textContent = 'Exporting...';

          const response = await chrome.runtime.sendMessage({ type: 'DEBUG_EXPORT' });
          if (response?.success) {
            // Get browser type for filename
            const ua = navigator.userAgent;
            const browser = ua.includes('Brave') ? 'brave' :
                           ua.includes('Edg') ? 'edge' : 'chrome';

            // Create downloadable JSON file
            const exportData = {
              exportedAt: new Date().toISOString(),
              browser,
              ...response.data
            };

            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bmaestro-debug-${browser}-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showNotification(`Downloaded debug file: ${response.data.totalFolders} folders, ${response.data.totalBookmarks} bookmarks`, 'success');
          } else {
            showNotification(`Export failed: ${response?.error || 'Unknown error'}`, 'error');
          }
        } catch (err: any) {
          console.error('[Popup] Debug export error:', err);
          showNotification(`Export failed: ${err.message || err}`, 'error');
        }

        debugExportBtn.disabled = false;
        debugExportBtn.textContent = 'Debug: Export Structure';
      });
    }

    // Sync log download
    const syncLogBtn = document.getElementById('syncLogBtn') as HTMLButtonElement | null;
    if (syncLogBtn) {
      syncLogBtn.addEventListener('click', async () => {
        try {
          syncLogBtn.disabled = true;
          syncLogBtn.textContent = 'Getting log...';

          const response = await chrome.runtime.sendMessage({ type: 'GET_SYNC_LOG' });
          if (response?.success && response.log) {
            // Get browser type for filename
            const ua = navigator.userAgent;
            const browser = ua.includes('Brave') ? 'brave' :
                           ua.includes('Edg') ? 'edge' : 'chrome';

            const blob = new Blob([JSON.stringify(response.log, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bmaestro-synclog-${browser}-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            const fallbacks = response.log.filter((e: any) => e.result === 'fallback').length;
            const errors = response.log.filter((e: any) => e.result === 'error').length;
            showNotification(`Downloaded ${response.log.length} entries (${fallbacks} fallbacks, ${errors} errors)`, 'success');
          } else {
            showNotification(`Failed: ${response?.error || 'No log data'}`, 'error');
          }
        } catch (err: any) {
          showNotification(`Error: ${err.message || err}`, 'error');
        }

        syncLogBtn.disabled = false;
        syncLogBtn.textContent = 'Debug: Download Sync Log';
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

    // Check for updates function
    async function checkForUpdates(): Promise<void> {
      try {
        const res = await fetch(CLOUD_CONFIG.versionUrl);
        const data = await res.json();
        if (data.version && data.version !== EXTENSION_VERSION) {
          if (newVersionEl) newVersionEl.textContent = `v${data.version}`;
          if (updateBanner) updateBanner.classList.remove('hidden');
          if (menuVersionEl) {
            menuVersionEl.textContent = `v${EXTENSION_VERSION} (${data.version} available)`;
            menuVersionEl.classList.add('has-update');
          }
          showNotification(`Update ${data.version} available`, 'info');
        } else {
          if (menuVersionEl) {
            menuVersionEl.textContent = `v${EXTENSION_VERSION} (latest)`;
          }
          showNotification('You have the latest version', 'success');
        }
      } catch (err) {
        console.error('[Popup] Check update error:', err);
        showNotification('Failed to check for updates', 'error');
      }
    }

    // Check for updates button in menu
    const checkUpdateBtn = document.getElementById('checkUpdateBtn') as HTMLButtonElement | null;
    if (checkUpdateBtn) {
      checkUpdateBtn.addEventListener('click', async () => {
        checkUpdateBtn.disabled = true;
        checkUpdateBtn.textContent = '...';
        await checkForUpdates();
        checkUpdateBtn.disabled = false;
        checkUpdateBtn.textContent = 'Check';
      });
    }

    // Auto-check for updates on popup open (informational only - Chrome handles auto-update)
    if (updateBanner && newVersionEl) {
      fetch(CLOUD_CONFIG.versionUrl)
        .then(res => res.json())
        .then(async data => {
          if (data.version && data.version !== EXTENSION_VERSION) {
            newVersionEl.textContent = `v${data.version}`;
            updateBanner.classList.remove('hidden');
            if (menuVersionEl) {
              menuVersionEl.textContent = `v${EXTENSION_VERSION} (${data.version} available)`;
              menuVersionEl.classList.add('has-update');
            }
          } else {
            // Versions match - clear any stale update data
            updateBanner.classList.add('hidden');
            if (menuVersionEl) {
              menuVersionEl.textContent = `v${EXTENSION_VERSION}`;
              menuVersionEl.classList.remove('has-update');
            }
            // Clear stale storage and badge
            await chrome.storage.local.remove(['updateAvailable', 'latestVersion', 'lastUpdateDownload']);
            // Only clear badge if no pending moderations
            const { pendingModerationCount, badgeType } = await chrome.storage.local.get(['pendingModerationCount', 'badgeType']);
            if (badgeType === 'update' || (!pendingModerationCount || pendingModerationCount === 0)) {
              await chrome.storage.local.remove(['badgeReason', 'badgeType']);
              chrome.action.setBadgeText({ text: '' });
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

    // Settings menu
    const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement | null;
    const settingsMenu = document.getElementById('settingsMenu');
    const logoutBtn = document.getElementById('logoutBtn') as HTMLButtonElement | null;
    const badgeStatusSection = document.getElementById('badgeStatusSection');
    const badgeStatusText = document.getElementById('badgeStatusText');

    // Function to update badge status display
    async function updateBadgeStatus(): Promise<void> {
      if (!badgeStatusSection || !badgeStatusText) return;

      try {
        const { badgeReason, badgeType } = await chrome.storage.local.get(['badgeReason', 'badgeType']);

        if (badgeReason) {
          badgeStatusText.textContent = badgeReason;
          badgeStatusText.className = 'badge-status-text' + (badgeType === 'error' ? ' error' : '');
          badgeStatusSection.classList.remove('hidden');
        } else {
          badgeStatusSection.classList.add('hidden');
        }
      } catch (err) {
        console.error('[Popup] Failed to get badge status:', err);
        badgeStatusSection.classList.add('hidden');
      }
    }

    if (settingsBtn && settingsMenu) {
      settingsBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('hidden');
        // Update badge status when menu is opened
        if (!settingsMenu.classList.contains('hidden')) {
          await updateBadgeStatus();
        }
      });

      // Close menu when clicking outside
      document.addEventListener('click', () => {
        settingsMenu.classList.add('hidden');
      });

      settingsMenu.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    // Check badge status on popup open
    updateBadgeStatus();

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
