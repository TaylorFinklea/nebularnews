<script>
  import { invalidate } from '$app/navigation';
  import { apiFetch } from '$lib/client/api-fetch';
  import { IconDownload, IconPlus, IconRss, IconTrash, IconUpload } from '$lib/icons';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Card from '$lib/components/Card.svelte';
  import Button from '$lib/components/Button.svelte';
  import { showToast } from '$lib/client/toast';
  export let data;

  let newUrl = '';
  let opmlText = '';

  const addFeed = async () => {
    if (!newUrl) return;
    const res = await apiFetch('/api/feeds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: newUrl })
    });
    if (res.ok) {
      showToast('Feed added.', 'success');
      newUrl = '';
    } else {
      const payload = await res.json().catch(() => ({}));
      showToast(payload?.error ?? 'Failed to add feed.', 'error');
    }
    await invalidate();
  };

  const removeFeed = async (id) => {
    await apiFetch(`/api/feeds/${id}`, { method: 'DELETE' });
    showToast('Feed removed.', 'success');
    await invalidate();
  };

  const importOpml = async () => {
    if (!opmlText) return;
    const res = await apiFetch('/api/feeds/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ opml: opmlText })
    });
    if (res.ok) {
      showToast('OPML imported.', 'success');
      opmlText = '';
    } else {
      showToast('OPML import failed.', 'error');
    }
    await invalidate();
  };
</script>

<PageHeader title="Feeds" description="Curate the signals that power your Nebular News.">
  <svelte:fragment slot="actions">
    <a class="btn-export" href="/api/feeds/export" title="Export OPML" aria-label="Export OPML">
      <IconDownload size={16} stroke={1.9} />
      <span>Export OPML</span>
    </a>
  </svelte:fragment>
</PageHeader>

<div class="grid">
  <Card>
    <h2>Add a feed</h2>
    <div class="input-row">
      <input placeholder="https://example.com/rss" bind:value={newUrl} />
      <Button variant="primary" size="icon" on:click={addFeed} title="Add feed">
        <IconPlus size={16} stroke={1.9} />
      </Button>
    </div>

    <h3>Import OPML</h3>
    <textarea rows="5" placeholder="Paste OPML here" bind:value={opmlText}></textarea>
    <Button variant="primary" size="inline" on:click={importOpml}>
      <IconUpload size={16} stroke={1.9} />
      <span>Import</span>
    </Button>
  </Card>

  <Card>
    <h2>Lowest Rated Feeds</h2>
    <p class="muted">Only feeds with thumbs feedback appear here.</p>
    {#if data.lowestRatedFeeds.length === 0}
      <p class="muted">No rated feeds yet.</p>
    {:else}
      <ul>
        {#each data.lowestRatedFeeds as feed}
          <li>
            <div class="feed-info">
              <strong>{feed.title ?? feed.url}</strong>
              <div class="meta">{feed.url}</div>
              <div class="meta">
                Reputation: {Number(feed.reputation ?? 0).toFixed(2)} ({feed.feedback_count} votes)
              </div>
            </div>
            <Button variant="ghost" size="icon" on:click={() => removeFeed(feed.id)} title="Remove feed">
              <IconTrash size={16} stroke={1.9} />
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
  </Card>

  <Card>
    <div class="feed-list-head">
      <h2>Current feeds</h2>
      <span class="count">{data.feeds.length}</span>
    </div>
    {#if data.feeds.length === 0}
      <div class="empty-state">
        <IconRss size={36} stroke={1.5} />
        <p>No feeds yet. Add your first RSS feed above.</p>
      </div>
    {:else}
      <ul>
        {#each data.feeds as feed}
          <li>
            <div class="feed-info">
              <strong>{feed.title ?? feed.url}</strong>
              <div class="meta">{feed.url}</div>
              <div class="meta">
                Reputation: {Number(feed.reputation ?? 0).toFixed(2)}
                {#if feed.feedback_count}
                  ({feed.feedback_count} votes)
                {:else}
                  (no votes yet)
                {/if}
              </div>
            </div>
            <Button variant="ghost" size="icon" on:click={() => removeFeed(feed.id)} title="Remove feed">
              <IconTrash size={16} stroke={1.9} />
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
  </Card>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: var(--space-6);
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  h3 {
    margin: var(--space-2) 0 0;
    font-size: var(--text-base);
    color: var(--muted-text);
    font-weight: 600;
  }

  .input-row {
    display: flex;
    gap: var(--space-2);
  }

  input,
  textarea {
    width: 100%;
    padding: 0.65rem 0.8rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--text-color);
    font-family: inherit;
    resize: vertical;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-3);
  }

  li {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--surface-border);
  }

  li:last-child {
    padding-bottom: 0;
    border-bottom: none;
  }

  .feed-info {
    min-width: 0;
  }

  .feed-info strong {
    display: block;
    word-break: break-word;
  }

  .meta {
    font-size: var(--text-sm);
    color: var(--muted-text);
    word-break: break-all;
    margin-top: 0.15rem;
  }

  .muted {
    color: var(--muted-text);
    margin: 0;
  }

  .feed-list-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .count {
    background: var(--surface-soft);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-full);
    padding: 0.1rem 0.55rem;
    font-size: var(--text-sm);
    color: var(--muted-text);
    font-weight: 600;
  }

  .empty-state {
    display: grid;
    place-items: center;
    gap: var(--space-3);
    padding: var(--space-8) 0;
    color: var(--muted-text);
    text-align: center;
  }

  .btn-export {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--button-bg);
    color: var(--button-text);
    border-radius: var(--radius-full);
    padding: 0.5rem 1rem;
    font-size: var(--text-sm);
    font-weight: 600;
    text-decoration: none;
    transition: opacity var(--transition-fast);
  }

  .btn-export:hover {
    opacity: 0.85;
  }
</style>
