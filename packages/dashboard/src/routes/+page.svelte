<!-- packages/dashboard/src/routes/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';

  let browsers: Array<{
    id: string;
    name: string;
    isConnected: boolean;
    isCanonical: boolean;
    lastSync: string | null;
    bookmarkCount: number;
  }> = [];

  let loading = true;
  let error: string | null = null;

  onMount(async () => {
    try {
      // TODO: Fetch from PocketBase
      browsers = [
        {
          id: '1',
          name: 'chrome',
          isConnected: true,
          isCanonical: true,
          lastSync: new Date().toISOString(),
          bookmarkCount: 142,
        },
        {
          id: '2',
          name: 'brave',
          isConnected: true,
          isCanonical: false,
          lastSync: new Date().toISOString(),
          bookmarkCount: 138,
        },
        {
          id: '3',
          name: 'edge',
          isConnected: false,
          isCanonical: false,
          lastSync: null,
          bookmarkCount: 0,
        },
      ];
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>BMaestro Dashboard</title>
</svelte:head>

<main>
  <header>
    <h1>BMaestro</h1>
    <p>Cross-Browser Bookmark Sync</p>
  </header>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else}
    <section class="browsers">
      <h2>Connected Browsers</h2>
      <div class="browser-grid">
        {#each browsers as browser}
          <div class="browser-card" class:connected={browser.isConnected} class:canonical={browser.isCanonical}>
            <div class="browser-header">
              <span class="browser-icon">{browser.name === 'chrome' ? '🔵' : browser.name === 'brave' ? '🦁' : '🌐'}</span>
              <span class="browser-name">{browser.name}</span>
              {#if browser.isCanonical}
                <span class="canonical-badge">Canonical</span>
              {/if}
            </div>
            <div class="browser-stats">
              <div class="stat">
                <span class="stat-value">{browser.bookmarkCount}</span>
                <span class="stat-label">Bookmarks</span>
              </div>
              <div class="stat">
                <span class="stat-value">{browser.isConnected ? '✓' : '✗'}</span>
                <span class="stat-label">Status</span>
              </div>
            </div>
            <div class="browser-footer">
              {#if browser.lastSync}
                Last sync: {new Date(browser.lastSync).toLocaleString()}
              {:else}
                Never synced
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </section>

    <section class="actions">
      <button class="primary">Sync All</button>
      <button>View Conflicts</button>
      <button>Export Bookmarks</button>
    </section>
  {/if}
</main>

<style>
  :global(body) {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    margin: 0;
    padding: 0;
    background: #f5f5f5;
    color: #1a1a1a;
  }

  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
  }

  header {
    margin-bottom: 2rem;
  }

  h1 {
    font-size: 2rem;
    margin: 0;
  }

  header p {
    color: #666;
    margin: 0.5rem 0 0;
  }

  h2 {
    font-size: 1.25rem;
    margin: 0 0 1rem;
  }

  .browser-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
  }

  .browser-card {
    background: white;
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    border: 2px solid transparent;
  }

  .browser-card.connected {
    border-color: #22c55e;
  }

  .browser-card.canonical {
    border-color: #3b82f6;
  }

  .browser-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .browser-icon {
    font-size: 1.5rem;
  }

  .browser-name {
    font-weight: 600;
    text-transform: capitalize;
  }

  .canonical-badge {
    margin-left: auto;
    background: #3b82f6;
    color: white;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .browser-stats {
    display: flex;
    gap: 2rem;
    margin-bottom: 1rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
  }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 600;
  }

  .stat-label {
    font-size: 0.75rem;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .browser-footer {
    font-size: 0.875rem;
    color: #666;
  }

  .actions {
    margin-top: 2rem;
    display: flex;
    gap: 1rem;
  }

  button {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    background: #e5e5e5;
    color: #1a1a1a;
    transition: background 0.2s;
  }

  button:hover {
    background: #d4d4d4;
  }

  button.primary {
    background: #3b82f6;
    color: white;
  }

  button.primary:hover {
    background: #2563eb;
  }

  .loading, .error {
    padding: 2rem;
    text-align: center;
  }

  .error {
    color: #ef4444;
  }
</style>
