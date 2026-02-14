<script>
  import { invalidateAll } from '$app/navigation';
  import { IconThumbDown, IconThumbUp } from '$lib/icons';
  export let data;

  const scoreLabel = (score) => {
    if (!score) return 'Unscored';
    if (score >= 5) return 'Perfect fit';
    if (score >= 4) return 'Strong fit';
    if (score >= 3) return 'Okay fit';
    if (score >= 2) return 'Weak fit';
    return 'Not a fit';
  };

  let query = data.q ?? '';
  let scoreFilter = data.scoreFilter ?? 'all';
  let readFilter = data.readFilter ?? 'all';
  let selectedTagIds = data.selectedTagIds ?? [];

  $: query = data.q ?? '';
  $: scoreFilter = data.scoreFilter ?? 'all';
  $: readFilter = data.readFilter ?? 'all';
  $: selectedTagIds = data.selectedTagIds ?? [];

  const reactToArticle = async (articleId, value, feedId) => {
    await fetch(`/api/articles/${articleId}/reaction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value, feedId })
    });
    await invalidateAll();
  };

  const setReadState = async (articleId, isRead) => {
    await fetch(`/api/articles/${articleId}/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isRead })
    });
    await invalidateAll();
  };
</script>

<section class="page-header">
  <div>
    <h1>Articles</h1>
    <p>Review summaries and tune the relevance score.</p>
  </div>
</section>

<form class="filters" method="get">
  <input name="q" placeholder="Search headlines and summaries" bind:value={query} />
  <select name="score" bind:value={scoreFilter}>
    <option value="all">All scores</option>
    <option value="4plus">4–5 (Strong fit)</option>
    <option value="3plus">3–5 (Okay+)</option>
    <option value="low">1–2 (Low fit)</option>
    <option value="unscored">Unscored</option>
  </select>
  <select name="read" bind:value={readFilter}>
    <option value="all">All articles</option>
    <option value="unread">Unread only</option>
    <option value="read">Read only</option>
  </select>
  <select name="tags" multiple bind:value={selectedTagIds} size="4">
    {#each data.availableTags ?? [] as tag}
      <option value={tag.id}>{tag.name} ({tag.article_count})</option>
    {/each}
  </select>
  <button type="submit">Filter</button>
  {#if selectedTagIds.length > 0}
    <a class="clear-link" href="/articles">Clear tags</a>
  {/if}
</form>

<div class="articles">
  {#if data.articles.length === 0}
    <p class="muted">No articles yet. Add feeds to start pulling stories.</p>
  {:else}
    {#each data.articles as article}
      <article class="card">
        <div class="card-head">
          <h2>{article.title ?? 'Untitled article'}</h2>
          <div class="pills">
            <span class={`pill ${article.is_read ? 'read' : 'unread'}`}>
              {article.is_read ? 'Read' : 'Unread'}
            </span>
            <span class="pill">{scoreLabel(article.score)}</span>
          </div>
        </div>
        <p class="excerpt">{article.summary_text ?? article.excerpt ?? ''}</p>
        <div class="meta">
          <span>
            {article.source_name ?? 'Unknown source'}
            {#if article.source_feedback_count}
              · rep {article.source_reputation.toFixed(2)} ({article.source_feedback_count} votes)
            {/if}
          </span>
          <span>{article.published_at ? new Date(article.published_at).toLocaleString() : ''}</span>
        </div>
        {#if article.author}
          <div class="byline">By {article.author}</div>
        {/if}
        {#if article.tags?.length}
          <div class="tag-row">
            {#each article.tags as tag}
              <span class="tag-pill">{tag.name}</span>
            {/each}
          </div>
        {/if}
        <div class="reactions">
          <button
            type="button"
            class:active={article.reaction_value === 1}
            on:click={() => reactToArticle(article.id, 1, article.source_feed_id)}
          >
            <IconThumbUp size={16} stroke={1.9} />
            <span>Thumbs up</span>
          </button>
          <button
            type="button"
            class:active={article.reaction_value === -1}
            on:click={() => reactToArticle(article.id, -1, article.source_feed_id)}
          >
            <IconThumbDown size={16} stroke={1.9} />
            <span>Thumbs down</span>
          </button>
        </div>
        <div class="read-actions">
          <button
            type="button"
            class="ghost"
            on:click={() => setReadState(article.id, article.is_read ? false : true)}
          >
            {article.is_read ? 'Mark unread' : 'Mark read'}
          </button>
        </div>
        <a class="button" href={`/articles/${article.id}`}>Open</a>
      </article>
    {/each}
  {/if}
</div>

<style>
  .articles {
    display: grid;
    gap: 1.5rem;
  }

  .card {
    background: var(--surface-strong);
    padding: 1.6rem;
    border-radius: 22px;
    box-shadow: 0 16px 30px var(--shadow-color);
    border: 1px solid var(--surface-border);
  }

  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .pills {
    display: inline-flex;
    gap: 0.5rem;
  }

  .pill {
    background: var(--primary-soft);
    color: var(--primary);
    padding: 0.3rem 0.7rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .pill.read {
    background: var(--surface-soft);
    color: var(--muted-text);
  }

  .pill.unread {
    background: var(--primary-soft);
    color: var(--primary);
  }

  .excerpt {
    margin-top: 0.8rem;
    color: var(--muted-text);
  }

  .meta {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    color: var(--muted-text);
    margin-top: 0.8rem;
  }

  .byline {
    margin-top: 0.4rem;
    font-size: 0.85rem;
    color: var(--muted-text);
  }

  .button {
    margin-top: 1rem;
    display: inline-block;
    background: var(--button-bg);
    color: var(--button-text);
    padding: 0.5rem 1rem;
    border-radius: 999px;
  }

  .reactions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.7rem;
  }

  .reactions button {
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
    border-radius: 999px;
    padding: 0.35rem 0.65rem;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--text-color);
  }

  .reactions button.active {
    border-color: var(--ghost-border);
    background: var(--primary-soft);
    color: var(--primary);
  }

  .read-actions {
    margin-top: 0.7rem;
  }

  .read-actions .ghost {
    border: 1px solid var(--ghost-border);
    background: transparent;
    color: var(--ghost-color);
    border-radius: 999px;
    padding: 0.35rem 0.75rem;
    cursor: pointer;
  }

  .tag-row {
    margin-top: 0.7rem;
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .tag-pill {
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
    border-radius: 999px;
    padding: 0.2rem 0.55rem;
    font-size: 0.78rem;
    color: var(--muted-text);
  }

  .filters {
    display: flex;
    gap: 0.8rem;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  input,
  select {
    padding: 0.6rem 0.8rem;
    border-radius: 12px;
    border: 1px solid var(--input-border);
    font-family: inherit;
  }

  select {
    min-width: 180px;
  }

  select[multiple] {
    min-width: 230px;
    min-height: 126px;
  }

  form button {
    background: var(--button-bg);
    color: var(--button-text);
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 999px;
    cursor: pointer;
  }

  .clear-link {
    color: var(--muted-text);
    font-size: 0.9rem;
  }

  .muted {
    color: var(--muted-text);
  }

  @media (max-width: 700px) {
    .filters {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
