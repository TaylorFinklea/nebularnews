<script>
  import { invalidateAll } from '$app/navigation';
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

  $: query = data.q ?? '';
  $: scoreFilter = data.scoreFilter ?? 'all';

  const reactToArticle = async (articleId, value, feedId) => {
    await fetch(`/api/articles/${articleId}/reaction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value, feedId })
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
  <button type="submit">Filter</button>
</form>

<div class="articles">
  {#if data.articles.length === 0}
    <p class="muted">No articles yet. Add feeds to start pulling stories.</p>
  {:else}
    {#each data.articles as article}
      <article class="card">
        <div class="card-head">
          <h2>{article.title ?? 'Untitled article'}</h2>
          <span class="pill">{scoreLabel(article.score)}</span>
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
        <div class="reactions">
          <button
            class:active={article.reaction_value === 1}
            on:click={() => reactToArticle(article.id, 1, article.source_feed_id)}
          >
            Thumbs up
          </button>
          <button
            class:active={article.reaction_value === -1}
            on:click={() => reactToArticle(article.id, -1, article.source_feed_id)}
          >
            Thumbs down
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
    background: rgba(255, 255, 255, 0.95);
    padding: 1.6rem;
    border-radius: 22px;
    box-shadow: 0 16px 30px rgba(0, 0, 0, 0.08);
  }

  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .pill {
    background: rgba(197, 91, 42, 0.16);
    color: #c55b2a;
    padding: 0.3rem 0.7rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .excerpt {
    margin-top: 0.8rem;
    color: rgba(0, 0, 0, 0.7);
  }

  .meta {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    color: rgba(0, 0, 0, 0.6);
    margin-top: 0.8rem;
  }

  .byline {
    margin-top: 0.4rem;
    font-size: 0.85rem;
    color: rgba(0, 0, 0, 0.55);
  }

  .button {
    margin-top: 1rem;
    display: inline-block;
    background: #1f1f1f;
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 999px;
  }

  .reactions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.7rem;
  }

  .reactions button {
    border: 1px solid rgba(0, 0, 0, 0.18);
    background: transparent;
    border-radius: 999px;
    padding: 0.35rem 0.65rem;
    cursor: pointer;
  }

  .reactions button.active {
    border-color: rgba(197, 91, 42, 0.5);
    background: rgba(197, 91, 42, 0.15);
    color: #7f3b1f;
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
    border: 1px solid rgba(0, 0, 0, 0.15);
    font-family: inherit;
  }

  select {
    min-width: 180px;
  }

  form button {
    background: #c55b2a;
    color: white;
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 999px;
    cursor: pointer;
  }

  .muted {
    color: rgba(0, 0, 0, 0.6);
  }

  @media (max-width: 700px) {
    .filters {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
