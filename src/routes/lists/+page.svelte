<script>
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import { getFitScoreText, getFitScoreTone } from '$lib/fit-score';

  export let data;

  const formatDate = (ts) => {
    if (!ts) return '';
    try {
      return new Date(Number(ts) * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };
</script>

<PageHeader title="Lists" description="Your saved articles." />

{#if data.articles.length === 0}
  <p class="empty">No saved articles yet. Save articles from the article view to see them here.</p>
{:else}
  <p class="count">{data.pagination.total} saved article{data.pagination.total === 1 ? '' : 's'}</p>

  <ul class="article-list">
    {#each data.articles as article}
      {@const tone = getFitScoreTone(article.score, article.score_status)}
      <li class="article-row">
        <a href={article.canonical_url ?? '#'} class="article-link" target="_blank" rel="noopener noreferrer">
          <div class="score-bar" data-tone={tone}></div>
          <div class="article-body">
            <div class="article-meta">
              {#if article.source_name}
                <span class="source">{article.source_name}</span>
              {/if}
              {#if article.published_at}
                <span class="date">{formatDate(article.published_at)}</span>
              {/if}
              {#if article.score != null}
                <span class="score" data-tone={tone}>{getFitScoreText(article.score, article.score_status)}</span>
              {/if}
            </div>
            <h2 class="article-title">{article.title ?? 'Untitled'}</h2>
            {#if article.excerpt}
              <p class="article-excerpt">{article.excerpt}</p>
            {/if}
          </div>
        </a>
      </li>
    {/each}
  </ul>

  <Pagination
    pagination={data.pagination}
    hrefBuilder={(p) => `/lists?page=${p}`}
  />
{/if}

<style>
  .empty {
    color: var(--muted-text);
    margin: var(--space-6) 0;
  }

  .count {
    color: var(--muted-text);
    font-size: var(--text-sm);
    margin-bottom: var(--space-4);
  }

  .article-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }

  .article-row {
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    background: var(--surface);
    overflow: hidden;
    transition: border-color 0.15s ease;
  }

  .article-row:hover {
    border-color: var(--surface-border-hover);
  }

  .article-link {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-4);
    color: var(--text-color);
  }

  .score-bar {
    flex-shrink: 0;
    width: 3px;
    border-radius: var(--radius-full);
    background: var(--muted-text);
    opacity: 0.3;
    align-self: stretch;
    min-height: 2rem;
  }

  .score-bar[data-tone='excellent'] { background: #4ade80; opacity: 0.7; }
  .score-bar[data-tone='good'] { background: #86efac; opacity: 0.6; }
  .score-bar[data-tone='neutral'] { background: var(--muted-text); opacity: 0.3; }
  .score-bar[data-tone='low'] { background: var(--muted-text); opacity: 0.2; }

  .article-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .article-meta {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .source {
    font-size: var(--text-xs);
    color: var(--muted-text);
    font-weight: 500;
  }

  .date {
    font-size: var(--text-xs);
    color: var(--muted-text);
  }

  .score {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--muted-text);
  }

  .score[data-tone='excellent'] { color: #4ade80; }
  .score[data-tone='good'] { color: #86efac; }

  .article-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
    line-height: var(--leading-snug);
  }

  .article-excerpt {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted-text);
    line-height: var(--leading-relaxed);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
