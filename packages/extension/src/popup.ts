// packages/extension/src/popup.ts

async function init() {
  const indicator = document.getElementById('indicator')!;
  const statusText = document.getElementById('statusText')!;
  const bookmarkCount = document.getElementById('bookmarkCount')!;
  const lastSync = document.getElementById('lastSync')!;
  const syncNowBtn = document.getElementById('syncNow')!;
  const openDashboardBtn = document.getElementById('openDashboard')!;

  // Get background page references
  const bg = await chrome.runtime.getBackgroundPage();
  const client = (bg as any)?.bmaestroClient;
  const getTree = (bg as any)?.bmaestroGetTree;

  // Update status
  async function updateStatus() {
    try {
      if (client) {
        const status = await client.getStatus();
        indicator.className = `indicator ${status.connected ? 'connected' : 'disconnected'}`;
        statusText.textContent = status.connected ? 'Connected' : 'Offline';
      } else {
        indicator.className = 'indicator disconnected';
        statusText.textContent = 'Not initialized';
      }
    } catch {
      indicator.className = 'indicator disconnected';
      statusText.textContent = 'Error';
    }
  }

  // Update bookmark count
  async function updateBookmarkCount() {
    try {
      const tree = await chrome.bookmarks.getTree();
      let count = 0;

      function countBookmarks(nodes: chrome.bookmarks.BookmarkTreeNode[]) {
        for (const node of nodes) {
          if (node.url) count++;
          if (node.children) countBookmarks(node.children);
        }
      }

      countBookmarks(tree);
      bookmarkCount.textContent = count.toString();
    } catch {
      bookmarkCount.textContent = '-';
    }
  }

  // Get last sync time
  async function updateLastSync() {
    const { lastSyncTime } = await chrome.storage.local.get('lastSyncTime');
    if (lastSyncTime) {
      const date = new Date(lastSyncTime);
      const now = new Date();
      const diff = now.getTime() - date.getTime();

      if (diff < 60000) {
        lastSync.textContent = 'Just now';
      } else if (diff < 3600000) {
        const mins = Math.floor(diff / 60000);
        lastSync.textContent = `${mins}m ago`;
      } else if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        lastSync.textContent = `${hours}h ago`;
      } else {
        lastSync.textContent = date.toLocaleDateString();
      }
    } else {
      lastSync.textContent = 'Never';
    }
  }

  // Sync now button
  syncNowBtn.addEventListener('click', async () => {
    if (!client) return;

    indicator.className = 'indicator syncing';
    statusText.textContent = 'Syncing...';

    try {
      await client.checkInSync();
      await chrome.storage.local.set({ lastSyncTime: Date.now() });
      await updateLastSync();
      indicator.className = 'indicator connected';
      statusText.textContent = 'Connected';
    } catch (err) {
      indicator.className = 'indicator disconnected';
      statusText.textContent = 'Sync failed';
    }
  });

  // Dashboard button
  openDashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://bmaestro-dashboard.fly.dev' });
  });

  // Initial update
  await Promise.all([
    updateStatus(),
    updateBookmarkCount(),
    updateLastSync(),
  ]);
}

init().catch(console.error);
