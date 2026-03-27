<script>
  import Card from '$lib/components/Card.svelte';
  import Button from '$lib/components/Button.svelte';
  export let data;

  let selectedUrls = new Set();
  let submitting = false;
  let error = '';

  function toggleFeed(url) {
    if (selectedUrls.has(url)) {
      selectedUrls.delete(url);
    } else {
      selectedUrls.add(url);
    }
    selectedUrls = selectedUrls;
  }

  function toggleCategory(feeds) {
    const allSelected = feeds.every(f => selectedUrls.has(f.url));
    for (const feed of feeds) {
      if (allSelected) {
        selectedUrls.delete(feed.url);
      } else {
        selectedUrls.add(feed.url);
      }
    }
    selectedUrls = selectedUrls;
  }

  async function subscribe() {
    if (selectedUrls.size === 0) return;
    submitting = true;
    error = '';
    try {
      const res = await fetch('/api/onboarding/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': document.cookie.match(/nn_csrf=([^;]+)/)?.[1] ?? ''
        },
        body: JSON.stringify({ feedUrls: [...selectedUrls] })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        error = data?.error ?? 'Failed to subscribe';
        return;
      }
      window.location.href = '/';
    } catch (err) {
      error = 'Network error. Please try again.';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="onboarding-shell">
  <div class="onboarding-content">
    <div class="header">
      <h1>Welcome to Nebular News</h1>
      <p class="subtitle">Pick some feeds to get started. You can always change these later.</p>
    </div>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    {#each data.catalog.categories as category}
      <Card variant="default">
        <div class="category-header">
          <h2>{category.name}</h2>
          <button
            class="select-all"
            on:click={() => toggleCategory(category.feeds)}
          >
            {category.feeds.every(f => selectedUrls.has(f.url)) ? 'Deselect all' : 'Select all'}
          </button>
        </div>
        <div class="feed-grid">
          {#each category.feeds as feed}
            <button
              class="feed-chip"
              class:selected={selectedUrls.has(feed.url)}
              on:click={() => toggleFeed(feed.url)}
            >
              <span class="feed-title">{feed.title}</span>
              <span class="feed-desc">{feed.description}</span>
            </button>
          {/each}
        </div>
      </Card>
    {/each}
  </div>

  <div class="footer-bar">
    <div class="footer-inner">
      <span class="count">{selectedUrls.size} feed{selectedUrls.size === 1 ? '' : 's'} selected</span>
      <Button on:click={subscribe} disabled={selectedUrls.size === 0 || submitting}>
        {submitting ? 'Setting up...' : `Subscribe & start reading`}
      </Button>
    </div>
  </div>
</div>

<style>
  .onboarding-shell {
    min-height: 100vh;
    padding-bottom: 80px;
  }

  .onboarding-content {
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .header {
    text-align: center;
    margin-bottom: var(--space-2);
  }

  .header h1 {
    margin: 0;
  }

  .subtitle {
    color: var(--text-muted);
    margin-top: var(--space-2);
  }

  .error {
    color: var(--danger);
    text-align: center;
  }

  .category-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: var(--space-3);
  }

  .category-header h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .select-all {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: var(--text-sm);
    font-family: inherit;
    padding: 0;
  }

  .select-all:hover {
    text-decoration: underline;
  }

  .feed-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .feed-chip {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--surface-border);
    background: var(--surface-1);
    color: var(--text-color);
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    transition: border-color 0.15s, background 0.15s;
  }

  .feed-chip:hover {
    border-color: var(--accent);
  }

  .feed-chip.selected {
    border-color: var(--accent);
    background: var(--accent-soft, rgba(99 102 241 / 0.1));
  }

  .feed-title {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .feed-desc {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .footer-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--surface-0);
    border-top: 1px solid var(--surface-border);
    padding: var(--space-3) var(--space-4);
    z-index: 100;
  }

  .footer-inner {
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .count {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
</style>
