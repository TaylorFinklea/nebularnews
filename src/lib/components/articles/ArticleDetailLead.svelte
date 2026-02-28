<script lang="ts">
  import { IconArrowLeft, IconExternalLink, IconEye, IconEyeOff, IconThumbDown, IconThumbUp, IconAdjustments, IconStars } from '$lib/icons';
  import Pill from '$lib/components/Pill.svelte';
  import type { ArticleLeadTagChip } from '$lib/client/articles/detail-types';

  export let backHref = '/articles';
  export let title = 'Untitled article';
  export let sourceName = 'Unknown source';
  export let author: string | null = null;
  export let publishedLabel = '';
  export let isRead = false;
  export let readBusy = false;
  export let reactionValue: number | null = null;
  export let reactionBusy = false;
  export let canonicalUrl: string | null = null;
  export let fitScore: number | null = null;
  export let fitLabel: string | null = null;
  export let leadTags: ArticleLeadTagChip[] = [];
  export let extraTagCount = 0;
  export let imageUrl: string | null = null;
  export let onToggleRead: (() => void) | undefined = undefined;
  export let onReactUp: (() => void) | undefined = undefined;
  export let onReactDown: (() => void) | undefined = undefined;
  export let onOpenUtilities: (() => void) | undefined = undefined;

  const scoreText = (value: number | null) => {
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized > 0 ? `${Math.round(normalized)}/5` : null;
  };
</script>

<section class:has-image={Boolean(imageUrl)} class:no-image={!imageUrl} class="lead-shell">
  <div class="lead-copy">
    <a class="back-link" href={backHref} data-sveltekit-reload="true">
      <IconArrowLeft size={16} stroke={1.9} />
      <span>Back to list</span>
    </a>

    <div class="meta-row">
      <span>{sourceName}</span>
      {#if publishedLabel}
        <span>{publishedLabel}</span>
      {/if}
      {#if author}
        <span>{author}</span>
      {/if}
    </div>

    <h1>{title}</h1>

    <div class="chip-row">
      <Pill variant={isRead ? 'muted' : 'default'}>{isRead ? 'Read' : 'Unread'}</Pill>
      {#if scoreText(fitScore)}
        <span class="meta-chip score-chip">
          <IconStars size={14} stroke={1.9} />
          <span>{scoreText(fitScore)}</span>
          {#if fitLabel}
            <span class="chip-separator">·</span>
            <span>{fitLabel}</span>
          {/if}
        </span>
      {/if}
      {#each leadTags as tag}
        <span class="meta-chip tag-chip">{tag.name}</span>
      {/each}
      {#if extraTagCount > 0}
        <span class="meta-chip tag-chip">+{extraTagCount}</span>
      {/if}
    </div>

    <div class="action-row">
      {#if canonicalUrl}
        <a class="action-primary" href={canonicalUrl} target="_blank" rel="noopener noreferrer">
          <IconExternalLink size={16} stroke={1.9} />
          <span>Open Original</span>
        </a>
      {/if}

      <button type="button" class="action-secondary" on:click={() => onToggleRead?.()} disabled={readBusy} aria-label={isRead ? 'Mark unread' : 'Mark read'}>
        {#if isRead}
          <IconEyeOff size={16} stroke={1.9} />
          <span>Mark Unread</span>
        {:else}
          <IconEye size={16} stroke={1.9} />
          <span>Mark Read</span>
        {/if}
      </button>

      <button
        type="button"
        class="action-icon"
        class:active={reactionValue === 1}
        on:click={() => onReactUp?.()}
        disabled={reactionBusy}
        aria-label="Thumbs up feed"
      >
        <IconThumbUp size={16} stroke={1.9} />
      </button>

      <button
        type="button"
        class="action-icon"
        class:active={reactionValue === -1}
        on:click={() => onReactDown?.()}
        disabled={reactionBusy}
        aria-label="Thumbs down feed"
      >
        <IconThumbDown size={16} stroke={1.9} />
      </button>

      <button type="button" class="action-secondary utilities-trigger" on:click={() => onOpenUtilities?.()} aria-label="Open utilities">
        <IconAdjustments size={16} stroke={1.9} />
        <span>Utilities</span>
      </button>
    </div>
  </div>

  {#if imageUrl}
    <div class="hero-wrap">
      <img class="hero-image" src={imageUrl} alt="" decoding="async" />
    </div>
  {/if}
</section>

<style>
  .lead-shell {
    min-width: 0;
    display: grid;
    gap: var(--space-5);
    padding: clamp(1.1rem, 2vw, 1.75rem);
    border-radius: clamp(1.2rem, 2vw, 1.8rem);
    border: 1px solid color-mix(in srgb, var(--surface-border) 120%, transparent);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--surface-strong) 92%, transparent), color-mix(in srgb, var(--surface) 90%, transparent)),
      radial-gradient(circle at top left, color-mix(in srgb, var(--primary-soft) 88%, transparent), transparent 42%),
      radial-gradient(circle at top right, color-mix(in srgb, var(--nebula-b) 65%, transparent), transparent 44%);
    box-shadow: 0 24px 55px color-mix(in srgb, var(--shadow-color) 70%, transparent);
    overflow: clip;
    position: relative;
  }

  .lead-copy {
    min-width: 0;
    display: grid;
    gap: var(--space-4);
  }

  .back-link {
    width: fit-content;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--muted-text);
    font-size: var(--text-sm);
    transition: color var(--transition-fast);
  }

  .back-link:hover {
    color: var(--primary);
  }

  .meta-row {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    color: var(--muted-text);
    font-size: var(--text-sm);
  }

  .meta-row span {
    overflow-wrap: anywhere;
  }

  .meta-row span:not(:first-child)::before {
    content: '•';
    margin-right: 0.5rem;
    color: color-mix(in srgb, var(--muted-text) 72%, transparent);
  }

  h1 {
    margin: 0;
    max-inline-size: 18ch;
    font-size: clamp(2rem, 3vw, 3.65rem);
    line-height: 1.02;
    letter-spacing: -0.03em;
    overflow-wrap: anywhere;
    text-wrap: balance;
  }

  .chip-row {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
  }

  .meta-chip {
    min-width: 0;
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.34rem 0.75rem;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--surface-soft) 92%, transparent);
    border: 1px solid color-mix(in srgb, var(--surface-border) 110%, transparent);
    font-size: var(--text-xs);
    color: var(--text-color);
    overflow-wrap: anywhere;
  }

  .score-chip {
    color: var(--primary-contrast);
    background: linear-gradient(90deg, color-mix(in srgb, var(--primary) 45%, transparent), color-mix(in srgb, var(--primary-soft) 92%, transparent));
  }

  .chip-separator {
    opacity: 0.7;
  }

  .action-row {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
  }

  .action-primary,
  .action-secondary,
  .action-icon {
    min-height: 44px;
    min-width: 44px;
    border-radius: var(--radius-full);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    font: inherit;
    transition: transform var(--transition-fast), background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), opacity var(--transition-fast);
  }

  .action-primary,
  .action-secondary {
    padding: 0.78rem 1.05rem;
  }

  .action-icon {
    width: 44px;
    padding: 0;
  }

  .action-primary {
    background: linear-gradient(90deg, var(--button-bg), color-mix(in srgb, var(--button-bg) 82%, white 18%));
    color: var(--button-text);
    border: 0;
  }

  .action-secondary,
  .action-icon {
    border: 1px solid color-mix(in srgb, var(--surface-border) 130%, transparent);
    background: color-mix(in srgb, var(--surface-soft) 96%, transparent);
    color: var(--text-color);
    cursor: pointer;
  }

  .action-icon.active {
    color: var(--primary);
    background: color-mix(in srgb, var(--primary-soft) 86%, transparent);
    border-color: color-mix(in srgb, var(--primary) 36%, transparent);
  }

  .action-secondary:hover:not(:disabled),
  .action-primary:hover,
  .action-icon:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .action-secondary:disabled,
  .action-icon:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .utilities-trigger {
    margin-left: auto;
  }

  .hero-wrap {
    min-width: 0;
    border-radius: calc(var(--radius-xl) + 0.2rem);
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--surface-border) 110%, transparent);
    background: color-mix(in srgb, var(--surface-soft) 92%, transparent);
  }

  .hero-image {
    width: 100%;
    max-width: 100%;
    display: block;
    aspect-ratio: 21 / 9;
    object-fit: cover;
  }

  .no-image {
    padding-bottom: clamp(1.4rem, 3vw, 2rem);
  }

  @media (min-width: 960px) {
    .utilities-trigger {
      display: none;
    }
  }

  @media (max-width: 959px) {
    h1 {
      max-inline-size: 100%;
    }

    .hero-image {
      aspect-ratio: 16 / 9;
    }
  }

  @media (max-width: 640px) {
    .action-primary,
    .action-secondary {
      flex: 1 1 12rem;
      min-width: 0;
    }

    .utilities-trigger {
      margin-left: 0;
    }
  }
</style>
