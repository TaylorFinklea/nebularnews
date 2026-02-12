<script>
  import { invalidateAll } from '$app/navigation';

  export let data;

  let isPulling = false;
  let pullMessage = '';

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

<section class="next-steps">
  <h3>Suggested next steps</h3>
  <ul>
    <li>Add RSS feeds in the Feeds tab.</li>
    <li>Store your LLM API keys in Settings.</li>
    <li>Review summaries and give feedback.</li>
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
    background: white;
    border-radius: 18px;
    padding: 1rem 1.4rem;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.08);
    text-align: center;
  }

  .stat h2 {
    margin: 0;
    font-size: 2rem;
    color: #c55b2a;
  }

  .next-steps {
    margin-top: 3rem;
    background: rgba(255, 255, 255, 0.8);
    border-radius: 20px;
    padding: 1.5rem;
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
    background: #1f1f1f;
    color: white;
    cursor: pointer;
  }

  .dev-tools button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .pull-message {
    margin: 0;
    color: rgba(0, 0, 0, 0.7);
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
  }
</style>
