<script>
  import { IconArrowLeft } from '$lib/icons';

  export let article;
  export let preferredSource = null;
  export let backHref = '/articles';
  export let articleImageUrl = '';
  export let isRead = false;
  export let readStateBusy = false;
</script>

<div class="article-header">
  <a class="back-link" href={backHref} data-sveltekit-reload="true">
    <IconArrowLeft size={16} stroke={1.9} />
    <span>Back to list</span>
  </a>
  <div class="header-meta">
    <h1>{article.title ?? 'Untitled article'}</h1>
    <div class="meta-row">
      <span>{preferredSource?.sourceName ?? 'Unknown source'}</span>
      {#if preferredSource?.feedbackCount}
        <span>· rep {preferredSource.reputation.toFixed(2)} ({preferredSource.feedbackCount} votes)</span>
      {/if}
      {#if article.author}
        <span>· {article.author}</span>
      {/if}
    </div>
  </div>
</div>

{#if articleImageUrl}
  <div class="article-hero">
    <img class="hero-img" src={articleImageUrl} alt="" decoding="async" />
  </div>
{/if}

<style>
  .article-header {
    margin-bottom: var(--space-4);
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--muted-text);
    font-size: var(--text-sm);
    margin-bottom: var(--space-3);
    transition: color var(--transition-fast);
  }

  .back-link:hover { color: var(--primary); }

  .header-meta {
    min-width: 0;
  }

  h1 {
    font-size: 2.6rem;
    font-weight: 700;
    margin: 0 0 var(--space-2);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight);
  }

  .meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    font-size: var(--text-sm);
    color: var(--muted-text);
  }

  .article-hero {
    margin-bottom: var(--space-6);
    border-radius: var(--radius-xl);
    overflow: hidden;
    background: var(--surface-soft);
    max-height: 340px;
  }

  .hero-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    aspect-ratio: 16/9;
  }

  @media (max-width: 900px) {
    h1 {
      font-size: var(--text-2xl);
    }
  }
</style>
