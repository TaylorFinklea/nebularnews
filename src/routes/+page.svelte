<script>
  import { invalidateAll } from '$app/navigation';

  export let data;

  let isPulling = false;
  let pullMessage = '';

  const scoreLabel = (score) => {
    if (score >= 5) return 'Perfect fit';
    if (score >= 4) return 'Strong fit';
    return 'Good fit';
  };

  const articleSnippet = (article) => {
    const text = article.summary_text ?? article.excerpt ?? '';
    return text.length > 220 ? `${text.slice(0, 220)}...` : text;
  };

  const runManualPull = async () => {
    isPulling = true;
    pullMessage = '';
    const cycles = data.isDev ? 3 : 1;
    try {
      const res = await fetch('/api/pull', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cycles })
      });
      const payload = await res.json();
      if (!res.ok) {
        pullMessage = payload?.error ?? 'Manual pull failed';
        return;
      }
      pullMessage = `Pull complete (${payload.cycles} cycle${payload.cycles === 1 ? '' : 's'}). Due feeds: ${payload.stats.dueFeeds}, items seen: ${payload.stats.itemsSeen}, items processed: ${payload.stats.itemsProcessed}, articles: ${payload.stats.articles}, pending jobs: ${payload.stats.pendingJobs}, feeds with errors: ${payload.stats.feedsWithErrors}.`;
      if (payload.stats?.recentErrors?.length) {
        const first = payload.stats.recentErrors[0];
        pullMessage += ` First error: ${first.url} -> ${first.message}`;
      }
      await invalidateAll();
    } catch {
      pullMessage = 'Manual pull failed';
    } finally {
      isPulling = false;
    }
  };

</script>

<section class="hero">
  <div>
    <h1>Your Nebula at a glance</h1>
    <p>Track the pulse of your feeds, summaries, and personalization queue.</p>
    <div class="dev-tools">
      <button on:click={runManualPull} disabled={isPulling}>
        {isPulling ? 'Pulling...' : 'Pull now'}
      </button>
      {#if pullMessage}
        <p class="pull-message">{pullMessage}</p>
      {/if}
    </div>
  </div>
  <div class="stats">
    <div class="stat">
      <h2>{data.stats.feeds}</h2>
      <span>Feeds</span>
    </div>
    <div class="stat">
      <h2>{data.stats.articles}</h2>
      <span>Articles</span>
    </div>
    <div class="stat">
      <h2>{data.stats.pendingJobs}</h2>
      <span><a href="/jobs?status=pending">Pending jobs</a></span>
    </div>
  </div>
</section>

<section class="pipeline">
  <div class="section-head">
    <h3>Today’s Pipeline Coverage</h3>
    <a href="/jobs">Manage queue in Jobs</a>
  </div>
  <div class="pipeline-stats">
    <div class="stat">
      <h2>{data.today.articles}</h2>
      <span>Today's articles</span>
    </div>
    <div class="stat">
      <h2>{data.today.summaries}</h2>
      <span>With summary</span>
    </div>
    <div class="stat">
      <h2>{data.today.scores}</h2>
      <span>With AI score</span>
    </div>
    <div class="stat">
      <h2>{data.today.pendingJobs}</h2>
      <span>Pending today jobs</span>
    </div>
    <div class="stat">
      <h2>{data.today.missingSummaries}</h2>
      <span>Missing summaries</span>
    </div>
    <div class="stat">
      <h2>{data.today.missingScores}</h2>
      <span>Missing scores</span>
    </div>
  </div>
</section>

<section class="top-rated">
  <div class="section-head">
    <h3>Top Rated Today (3+/5)</h3>
    <a href="/articles?score=3plus">Open full list</a>
  </div>
  {#if data.topRatedArticles.length === 0}
    <p class="muted">No top-rated items yet today. Run a pull or wait for scoring jobs to finish.</p>
  {:else}
    <div class="top-list">
      {#each data.topRatedArticles as article}
        <article class="top-card">
          <div class="top-card-head">
            <a class="title" href={`/articles/${article.id}`}>{article.title ?? 'Untitled article'}</a>
            <span class="pill">{article.score}/5 · {scoreLabel(article.score)}</span>
          </div>
          <p class="excerpt">{articleSnippet(article)}</p>
          <div class="meta">
            <span>{article.source_name ?? 'Unknown source'}</span>
            <span>{new Date(article.published_at ?? article.fetched_at).toLocaleString()}</span>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

<section class="next-steps">
  <h3>Suggested Next Steps</h3>
  <ul>
    <li>Use the Jobs page if today's summary/score backlog is non-zero.</li>
    <li>Open top-rated stories and apply thumbs feedback to tune source reputation.</li>
    <li>Regenerate summary with chat model only for stories you care about most.</li>
  </ul>
</section>

<style>
  .hero {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 2rem;
  }

  h1 {
    font-family: 'Source Serif 4', serif;
    font-size: 2.4rem;
    margin-bottom: 0.5rem;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 1rem;
  }

  .stat {
    background: var(--surface-strong);
    border-radius: 18px;
    padding: 1rem 1.4rem;
    box-shadow: 0 12px 30px var(--shadow-color);
    text-align: center;
    border: 1px solid var(--surface-border);
  }

  .stat h2 {
    margin: 0;
    font-size: 2rem;
    color: var(--primary);
  }

  .next-steps {
    margin-top: 3rem;
    background: var(--surface);
    border-radius: 20px;
    padding: 1.5rem;
    border: 1px solid var(--surface-border);
  }

  .pipeline {
    margin-top: 2.2rem;
  }

  .pipeline-stats {
    margin-top: 0.9rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 0.9rem;
  }

  .top-rated {
    margin-top: 2.2rem;
    background: var(--surface);
    border-radius: 20px;
    border: 1px solid var(--surface-border);
    padding: 1.4rem;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
  }

  .section-head a {
    color: var(--primary);
    font-size: 0.9rem;
  }

  .top-list {
    margin-top: 0.9rem;
    display: grid;
    gap: 0.9rem;
  }

  .top-card {
    background: var(--surface-strong);
    border: 1px solid var(--surface-border);
    border-radius: 16px;
    padding: 1rem;
  }

  .top-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .title {
    font-weight: 600;
  }

  .pill {
    background: var(--primary-soft);
    color: var(--primary);
    padding: 0.25rem 0.65rem;
    border-radius: 999px;
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .excerpt {
    margin: 0.65rem 0;
    color: var(--muted-text);
  }

  .meta {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    font-size: 0.82rem;
    color: var(--muted-text);
  }

  .dev-tools {
    margin-top: 1rem;
    display: grid;
    gap: 0.5rem;
  }

  .dev-tools button {
    width: fit-content;
    border: none;
    border-radius: 999px;
    padding: 0.55rem 0.95rem;
    background: var(--button-bg);
    color: var(--button-text);
    cursor: pointer;
  }

  .dev-tools button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .pull-message {
    margin: 0;
    color: var(--muted-text);
    font-size: 0.9rem;
  }

  ul {
    padding-left: 1.2rem;
  }

  @media (max-width: 800px) {
    .hero {
      flex-direction: column;
      align-items: flex-start;
    }

    .section-head {
      flex-direction: column;
      align-items: flex-start;
    }

    .top-card-head {
      flex-direction: column;
      align-items: flex-start;
    }

    .meta {
      flex-direction: column;
      gap: 0.2rem;
    }
  }
</style>
