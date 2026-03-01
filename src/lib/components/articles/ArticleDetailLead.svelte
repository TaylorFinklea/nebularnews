<script>
  import { createEventDispatcher } from 'svelte';
  import {
    IconArrowLeft,
    IconEye,
    IconEyeOff,
    IconExternalLink,
    IconStars
  } from '$lib/icons';
  import Button from '$lib/components/Button.svelte';
  import Pill from '$lib/components/Pill.svelte';

  export let article;
  export let preferredSource = null;
  export let backHref = '/articles';
  export let articleImageUrl = '';
  export let isRead = false;
  export let readStateBusy = false;
  export let score = null;

  const dispatch = createEventDispatcher();
</script>

<div class="article-header">
  <a class="back-link" href={backHref} data-sveltekit-reload="true">
    <IconArrowLeft size={16} stroke={1.9} />
    <span>Back to list</span>
  </a>
  <div class="header-row">
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
    <div class="header-actions">
      {#if article.canonical_url}
        <a
          class="open-btn"
          href={article.canonical_url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open original article"
        >
          <IconExternalLink size={15} stroke={1.9} />
          <span>Open article</span>
        </a>
      {/if}
      <Button
        variant="ghost"
        size="icon"
        on:click={() => dispatch('toggleRead')}
        disabled={readStateBusy}
        title={isRead ? 'Mark unread' : 'Mark read'}
      >
        {#if isRead}
          <IconEyeOff size={16} stroke={1.9} />
        {:else}
          <IconEye size={16} stroke={1.9} />
        {/if}
      </Button>
      <Pill variant={isRead ? 'muted' : 'default'}>
        {isRead ? 'Read' : 'Unread'}
      </Pill>
    </div>
  </div>
</div>

{#if articleImageUrl}
  <div class="article-hero">
    <img class="hero-img" src={articleImageUrl} alt="" decoding="async" />
  </div>
{/if}

{#if score}
  <div class="score-banner">
    <div class="score-val">
      <IconStars size={18} stroke={1.9} />
      <span>{score.score} / 5</span>
      <strong>· {score.label}</strong>
    </div>
    <p class="score-reason">{score.reason_text}</p>
    {#if score.evidence?.length}
      <ul class="score-evidence">
        {#each score.evidence as evidence}
          <li>{evidence}</li>
        {/each}
      </ul>
    {/if}
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

  .header-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .header-meta {
    flex: 1 1 0;
    min-width: 0;
  }

  h1 {
    font-size: var(--text-3xl);
    margin: 0 0 var(--space-2);
    line-height: 1.2;
  }

  .meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    font-size: var(--text-sm);
    color: var(--muted-text);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .open-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--button-bg);
    color: var(--button-text);
    border-radius: var(--radius-full);
    padding: 0.48rem 0.95rem;
    font-size: var(--text-sm);
    font-weight: 500;
    text-decoration: none;
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
    aspect-ratio: 21/9;
  }

  .score-banner {
    background: var(--primary-soft);
    border-radius: var(--radius-xl);
    padding: var(--space-5);
    display: grid;
    gap: var(--space-2);
    margin-bottom: var(--space-5);
  }

  .score-val {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: var(--text-lg);
    color: var(--primary);
    font-weight: 600;
  }

  .score-reason {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-color);
  }

  .score-evidence {
    margin: 0;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.25rem;
  }

  .score-evidence li {
    font-size: var(--text-sm);
    color: var(--muted-text);
  }

  @media (max-width: 900px) {
    h1 {
      font-size: var(--text-2xl);
    }
  }
</style>
