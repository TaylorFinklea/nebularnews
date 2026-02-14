<script>
  import { invalidate } from '$app/navigation';
  import { IconDownload, IconPlus, IconTrash, IconUpload } from '$lib/icons';
  export let data;

  let newUrl = '';
  let opmlText = '';

  const addFeed = async () => {
    if (!newUrl) return;
    await fetch('/api/feeds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: newUrl })
    });
    newUrl = '';
    await invalidate();
  };

  const removeFeed = async (id) => {
    await fetch(`/api/feeds/${id}`, { method: 'DELETE' });
    await invalidate();
  };

  const importOpml = async () => {
    if (!opmlText) return;
    await fetch('/api/feeds/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ opml: opmlText })
    });
    opmlText = '';
    await invalidate();
  };
</script>

<section class="page-header">
  <div>
    <h1>Feeds</h1>
    <p>Curate the signals that power your Nebular News.</p>
  </div>
  <a class="icon-button button" href="/api/feeds/export" title="Export OPML" aria-label="Export OPML">
    <IconDownload size={16} stroke={1.9} />
    <span class="sr-only">Export OPML</span>
  </a>
</section>

<div class="grid">
  <div class="card">
    <h2>Add a feed</h2>
    <div class="row">
      <input placeholder="https://example.com/rss" bind:value={newUrl} />
      <button class="icon-button" on:click={addFeed} title="Add feed" aria-label="Add feed">
        <IconPlus size={16} stroke={1.9} />
        <span class="sr-only">Add feed</span>
      </button>
    </div>
    <h3>Import OPML</h3>
    <textarea rows="6" placeholder="Paste OPML here" bind:value={opmlText}></textarea>
    <button on:click={importOpml} class="inline-button">
      <IconUpload size={16} stroke={1.9} />
      <span>Import</span>
    </button>
  </div>

  <div class="card">
    <h2>Current feeds</h2>
    {#if data.feeds.length === 0}
      <p class="muted">No feeds yet. Add your first RSS feed to get started.</p>
    {:else}
      <ul>
        {#each data.feeds as feed}
          <li>
            <div>
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
            <button class="ghost icon-button" on:click={() => removeFeed(feed.id)} title="Remove feed" aria-label="Remove feed">
              <IconTrash size={16} stroke={1.9} />
              <span class="sr-only">Remove feed</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }

  .button {
    background: var(--button-bg);
    color: var(--button-text);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
  }

  .card {
    background: var(--surface);
    padding: 1.5rem;
    border-radius: 20px;
    box-shadow: 0 12px 30px var(--shadow-color);
    border: 1px solid var(--surface-border);
  }

  .row {
    display: flex;
    gap: 0.6rem;
  }

  input,
  textarea {
    width: 100%;
    padding: 0.7rem;
    border-radius: 12px;
    border: 1px solid var(--input-border);
  }

  button {
    background: var(--button-bg);
    color: var(--button-text);
    border: none;
    padding: 0.7rem 1rem;
    border-radius: 999px;
    cursor: pointer;
  }

  .ghost {
    background: transparent;
    color: var(--ghost-color);
    border: 1px solid var(--ghost-border);
  }

  .icon-button {
    width: 2.2rem;
    height: 2.2rem;
    padding: 0;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .inline-button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    width: fit-content;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 1rem;
  }

  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .meta {
    font-size: 0.85rem;
    color: var(--muted-text);
  }

  .muted {
    color: var(--muted-text);
  }

  @media (max-width: 600px) {
    .page-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }
  }
</style>
