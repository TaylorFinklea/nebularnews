<script>
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { resolveArticleImageUrl } from '$lib/article-image';
  import { apiFetch } from '$lib/client/api-fetch';
  import {
    IconArrowLeft,
    IconCheck,
    IconEye,
    IconEyeOff,
    IconExternalLink,
    IconFileText,
    IconListDetails,
    IconPlus,
    IconSparkles,
    IconStars,
    IconTag,
    IconThumbDown,
    IconThumbUp,
    IconX
  } from '$lib/icons';
  import Card from '$lib/components/Card.svelte';
  import Button from '$lib/components/Button.svelte';
  import Pill from '$lib/components/Pill.svelte';
  import ChatBox from '$lib/components/ChatBox.svelte';
  export let data;

  let rating = 3;
  let comment = '';
  let threadId = null;
  let message = '';
  let chatLog = [];
  let sending = false;
  let rerunBusy = false;
  let readStateBusy = false;
  let tagBusy = false;
  let tagError = '';
  let tagInput = '';
  let chatError = '';
  const AUTO_MARK_READ_DELAY_MS = Number(data.autoReadDelayMs ?? 4000);
  let autoReadTimer = null;
  let fullTextSource = '';
  let articleBlocks = [];
  let backHref = '/articles';
  let articleImageUrl = '';

  const sanitizeBackHref = (value) => {
    if (!value || typeof value !== 'string') return '/articles';
    return value.startsWith('/articles') ? value : '/articles';
  };

  const decodeHtmlEntities = (value) =>
    value
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'");

  const htmlToMarkdownish = (html) => {
    if (!html) return '';
    return decodeHtmlEntities(
      String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n').replace(/<(h[1-6])[^>]*>/gi, '\n\n').replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<li[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '')
        .replace(/<\/(p|div|section|article|blockquote|ul|ol|pre|table|tr)>/gi, '\n\n')
        .replace(/<[^>]+>/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    );
  };

  const splitLongParagraph = (text) => {
    const compact = text.trim();
    if (compact.length < 520) return [compact];
    const sentences = compact.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean);
    if (!sentences || sentences.length < 4) return [compact];
    const groups = [];
    for (let i = 0; i < sentences.length; i += 3) groups.push(sentences.slice(i, i + 3).join(' '));
    return groups;
  };

  const parseArticleBlocks = (text) => {
    if (!text) return [];
    const normalized = String(text).replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
    if (!normalized) return [];
    return normalized.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean).map((chunk) => {
      const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return null;
      if (lines.length === 1 && /^#{1,6}\s+/.test(lines[0])) {
        const headingText = lines[0].replace(/^#{1,6}\s+/, '').trim();
        if (!headingText) return null;
        return { type: 'heading', text: headingText };
      }
      const bulletLines = lines.filter((line) => /^(?:[-*•]\s+|\d+[.)]\s+)/.test(line));
      if (bulletLines.length >= Math.max(2, Math.ceil(lines.length * 0.6))) {
        return { type: 'list', items: bulletLines.map((l) => l.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '').trim()).filter(Boolean) };
      }
      const paragraph = lines.join(' ');
      const chunks = splitLongParagraph(paragraph);
      if (chunks.length === 1) return { type: 'paragraph', text: chunks[0] };
      return { type: 'paragraph_group', paragraphs: chunks };
    }).filter(Boolean);
  };

  $: fullTextSource = (() => {
    const htmlFirst = htmlToMarkdownish(data.article?.content_html ?? '');
    if (htmlFirst && htmlFirst.length >= 80) return htmlFirst;
    return data.article?.content_text ?? '';
  })();

  $: backHref = sanitizeBackHref($page.url.searchParams.get('from'));
  $: articleImageUrl = resolveArticleImageUrl({
    id: data.article?.id ?? null,
    title: data.article?.title ?? null,
    source_name: data.preferredSource?.sourceName ?? null,
    image_url: data.article?.image_url ?? null,
    tags: data.tags ?? []
  });
  $: articleBlocks = parseArticleBlocks(fullTextSource);

  const submitFeedback = async () => {
    await apiFetch(`/api/articles/${data.article.id}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating, comment, feedId: data.preferredSource?.feedId ?? null })
    });
    comment = '';
    await invalidateAll();
  };

  const setReaction = async (value) => {
    await apiFetch(`/api/articles/${data.article.id}/reaction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value, feedId: data.preferredSource?.feedId ?? null })
    });
    await invalidateAll();
  };

  const sendMessage = async () => {
    if (!data.chatReadiness?.canChat) { chatError = data.chatReadiness?.reasons?.[0] ?? 'Chat is not ready yet.'; return; }
    if (!message) return;
    sending = true;
    chatError = '';
    try {
      if (!threadId) {
        const threadRes = await apiFetch('/api/chat/threads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: 'article', articleId: data.article.id, title: data.article.title })
        });
        const created = await threadRes.json().catch(() => ({}));
        if (!threadRes.ok || !created?.id) { chatError = created?.error ?? 'Failed to start article chat'; return; }
        threadId = created.id;
      }
      const userText = message;
      chatLog = [...chatLog, { role: 'user', content: userText }];
      message = '';
      const res = await apiFetch(`/api/chat/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: userText })
      });
      const response = await res.json().catch(() => ({}));
      if (!res.ok) { chatError = response?.error ?? 'Chat request failed'; return; }
      chatLog = [...chatLog, { role: 'assistant', content: response.response }];
    } catch {
      chatError = 'Chat request failed';
    } finally {
      sending = false;
    }
  };

  const rerunJobs = async (types) => {
    rerunBusy = true;
    await apiFetch(`/api/articles/${data.article.id}/rerun`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ types })
    });
    rerunBusy = false;
    await invalidateAll();
  };

  const setReadState = async (isRead) => {
    readStateBusy = true;
    try {
      await apiFetch(`/api/articles/${data.article.id}/read`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isRead })
      });
    } finally {
      readStateBusy = false;
      await invalidateAll();
    }
  };

  const addTags = async () => {
    const names = tagInput.split(',').map((e) => e.trim()).filter(Boolean);
    if (names.length === 0) return;
    tagBusy = true;
    tagError = '';
    try {
      const res = await apiFetch(`/api/articles/${data.article.id}/tags`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ addTagNames: names, source: 'manual' })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) { tagError = payload?.error ?? 'Failed to add tags'; return; }
      tagInput = '';
    } finally {
      tagBusy = false;
      await invalidateAll();
    }
  };

  const removeTag = async (tagId) => {
    tagBusy = true;
    tagError = '';
    try {
      const res = await apiFetch(`/api/articles/${data.article.id}/tags`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ removeTagIds: [tagId] })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) { tagError = payload?.error ?? 'Failed to remove tag'; }
    } finally {
      tagBusy = false;
      await invalidateAll();
    }
  };

  onMount(() => {
    if (data.article && !data.article.is_read) {
      autoReadTimer = setTimeout(() => {
        if (!data.article?.is_read) void setReadState(true);
      }, AUTO_MARK_READ_DELAY_MS);
    }
    return () => { if (autoReadTimer) clearTimeout(autoReadTimer); };
  });
</script>

{#if !data.article}
  <p>Article not found.</p>
{:else}
  <!-- Back + title -->
  <div class="article-header">
    <a class="back-link" href={backHref} data-sveltekit-reload="true">
      <IconArrowLeft size={16} stroke={1.9} />
      <span>Back to list</span>
    </a>
    <div class="header-row">
      <div class="header-meta">
        <h1>{data.article.title ?? 'Untitled article'}</h1>
        <div class="meta-row">
          <span>{data.preferredSource?.sourceName ?? 'Unknown source'}</span>
          {#if data.preferredSource?.feedbackCount}
            <span>· rep {data.preferredSource.reputation.toFixed(2)} ({data.preferredSource.feedbackCount} votes)</span>
          {/if}
          {#if data.article.author}
            <span>· {data.article.author}</span>
          {/if}
        </div>
      </div>
      <div class="header-actions">
        {#if data.article.canonical_url}
          <a
            class="open-btn"
            href={data.article.canonical_url}
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
          on:click={() => setReadState(!data.article.is_read)}
          disabled={readStateBusy}
          title={data.article.is_read ? 'Mark unread' : 'Mark read'}
        >
          {#if data.article.is_read}
            <IconEyeOff size={16} stroke={1.9} />
          {:else}
            <IconEye size={16} stroke={1.9} />
          {/if}
        </Button>
        <Pill variant={data.article.is_read ? 'muted' : 'default'}>
          {data.article.is_read ? 'Read' : 'Unread'}
        </Pill>
      </div>
    </div>
  </div>

  <!-- Hero image -->
  <div class="article-hero">
    <img class="hero-img" src={articleImageUrl} alt="" decoding="async" />
  </div>

  <!-- Two-column layout -->
  <div class="article-layout">
    <!-- LEFT: content -->
    <div class="content-col">
      {#if data.score}
        <div class="score-banner">
          <div class="score-val">
            <IconStars size={18} stroke={1.9} />
            <span>{data.score.score} / 5</span>
            <strong>· {data.score.label}</strong>
          </div>
          <p class="score-reason">{data.score.reason_text}</p>
          {#if data.score.evidence?.length}
            <ul class="score-evidence">
              {#each data.score.evidence as evidence}
                <li>{evidence}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <Card>
        <div class="card-title-row">
          <h2>Summary</h2>
          <Button variant="ghost" size="icon" on:click={() => rerunJobs(['summarize'])} disabled={rerunBusy} title="Rebuild summary">
            <IconFileText size={15} stroke={1.9} />
          </Button>
        </div>
        <p>{data.summary?.summary_text ?? 'Summary pending.'}</p>
        {#if data.summary?.provider && data.summary?.model}
          <p class="muted">Model: {data.summary.provider}/{data.summary.model}</p>
        {/if}
      </Card>

      {#if data.keyPoints?.points?.length}
        <Card>
          <div class="card-title-row">
            <h2>Key Points</h2>
            <Button variant="ghost" size="icon" on:click={() => rerunJobs(['key_points'])} disabled={rerunBusy} title="Rebuild key points">
              <IconListDetails size={15} stroke={1.9} />
            </Button>
          </div>
          <ul class="key-list">
            {#each data.keyPoints.points as point}
              <li>{point}</li>
            {/each}
          </ul>
        </Card>
      {/if}

      <Card>
        <h2>Full text</h2>
        <div class="article-text">
          {#if articleBlocks.length === 0}
            <p class="muted">Full text pending.</p>
          {:else}
            {#each articleBlocks as block}
              {#if block.type === 'list'}
                <ul class="article-list">
                  {#each block.items as item}<li>{item}</li>{/each}
                </ul>
              {:else if block.type === 'heading'}
                <h3 class="article-heading">{block.text}</h3>
              {:else if block.type === 'paragraph_group'}
                {#each block.paragraphs as paragraph}
                  <p class="article-paragraph">{paragraph}</p>
                {/each}
              {:else}
                <p class="article-paragraph">{block.text}</p>
              {/if}
            {/each}
          {/if}
        </div>
      </Card>
    </div>

    <!-- RIGHT: sidebar -->
    <div class="sidebar-col">
      <!-- Feed vote -->
      <Card>
        <h3>Feed vote</h3>
        <p class="muted small">Tune source reputation without affecting AI score.</p>
        <div class="reaction-row">
          <button
            class="reaction-btn"
            class:active={data.reaction?.value === 1}
            on:click={() => setReaction(1)}
            title="Thumbs up feed"
            aria-label="Thumbs up this feed"
          >
            <IconThumbUp size={16} stroke={1.9} />
          </button>
          <button
            class="reaction-btn"
            class:active={data.reaction?.value === -1}
            on:click={() => setReaction(-1)}
            title="Thumbs down feed"
            aria-label="Thumbs down this feed"
          >
            <IconThumbDown size={16} stroke={1.9} />
          </button>
        </div>
      </Card>

      <!-- Tags -->
      <Card>
        <div class="card-title-row">
          <h3>Tags</h3>
          <Button variant="ghost" size="icon" on:click={() => rerunJobs(['auto_tag'])} disabled={rerunBusy || tagBusy} title="Run AI tagging">
            <IconTag size={15} stroke={1.9} />
          </Button>
        </div>
        {#if data.tags?.length}
          <div class="tag-row">
            {#each data.tags as tag}
              <button
                class="tag-chip"
                on:click={() => removeTag(tag.id)}
                disabled={tagBusy}
                title={`Remove ${tag.name}`}
              >
                <span>{tag.name}</span>
                {#if tag.source === 'ai'}<span class="tag-ai">AI</span>{/if}
                <IconX size={11} stroke={2} />
              </button>
            {/each}
          </div>
        {:else}
          <p class="muted small">No tags yet.</p>
        {/if}
        <div class="input-row">
          <input
            list="article-tag-options"
            placeholder="Add tags (comma-separated)"
            bind:value={tagInput}
            disabled={tagBusy}
          />
          <Button variant="ghost" size="icon" on:click={addTags} disabled={tagBusy} title="Add tags">
            <IconPlus size={15} stroke={1.9} />
          </Button>
        </div>
        {#if tagError}<p class="muted small err">{tagError}</p>{/if}
      </Card>

      <!-- AI Score -->
      <Card>
        <div class="card-title-row">
          <h3>AI Fit Score</h3>
          <Button variant="ghost" size="icon" on:click={() => rerunJobs(['score'])} disabled={rerunBusy} title="Re-score article">
            <IconStars size={15} stroke={1.9} />
          </Button>
        </div>
        {#if data.score}
          <div class="score-display">
            <span class="score-num">{data.score.score}</span>
            <span class="score-denom">/ 5</span>
            <Pill>{data.score.label}</Pill>
          </div>
        {:else}
          <p class="muted small">Score pending.</p>
        {/if}
      </Card>

      <!-- Chat -->
      <Card>
        <div class="card-title-row">
          <h3>Chat with article</h3>
          <Pill variant={data.chatReadiness?.canChat ? 'success' : 'warning'}>
            {data.chatReadiness?.canChat ? 'Ready' : 'Needs setup'}
          </Pill>
        </div>
        <ChatBox
          {chatLog}
          bind:message
          {sending}
          disabled={!data.chatReadiness?.canChat}
          placeholder={data.chatReadiness?.canChat ? 'Ask about this article' : 'Complete chat setup first'}
          error={chatError}
          on:send={sendMessage}
        />
      </Card>

      <!-- Feedback -->
      <Card>
        <h3>Feedback</h3>
        <label class="form-label">
          Rating (1–5)
          <input type="number" min="1" max="5" bind:value={rating} />
        </label>
        <textarea rows="3" placeholder="What did the AI miss?" bind:value={comment}></textarea>
        <Button size="inline" on:click={submitFeedback}>
          <IconCheck size={15} stroke={1.9} />
          <span>Save feedback</span>
        </Button>
      </Card>

      <!-- Sources -->
      {#if data.sources?.length}
        <Card variant="soft">
          <h3>Source ranking</h3>
          <ul class="source-list">
            {#each data.sources as source}
              <li>
                <strong>{source.sourceName}</strong>
                <span class="muted">rep {source.reputation.toFixed(2)} ({source.feedbackCount} votes)</span>
              </li>
            {/each}
          </ul>
        </Card>
      {/if}
    </div>
  </div>
{/if}

<datalist id="article-tag-options">
  {#each data.availableTags ?? [] as tag}
    <option value={tag.name}></option>
  {/each}
</datalist>

<style>
  /* Header */
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
    font-family: 'Source Serif 4', serif;
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
    font-weight: 600;
    text-decoration: none;
  }

  /* Hero image */
  .article-hero {
    margin-bottom: var(--space-6);
    border-radius: var(--radius-xl);
    overflow: hidden;
    border: 1px solid var(--surface-border);
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

  /* Two-column layout */
  .article-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: var(--space-6);
    align-items: start;
  }

  .content-col, .sidebar-col {
    display: grid;
    gap: var(--space-5);
  }

  /* Score banner */
  .score-banner {
    background: var(--primary-soft);
    border: 1px solid var(--ghost-border);
    border-radius: var(--radius-xl);
    padding: var(--space-5);
    display: grid;
    gap: var(--space-2);
  }

  .score-val {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: var(--text-lg);
    color: var(--primary);
    font-weight: 700;
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

  /* Card internals */
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  h3 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
  }

  .card-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .muted { color: var(--muted-text); margin: 0; }
  .small { font-size: var(--text-sm); }
  .err { color: var(--danger); }

  /* Reaction buttons */
  .reaction-row {
    display: flex;
    gap: var(--space-2);
  }

  .reaction-btn {
    background: var(--surface-soft);
    border: 1px solid var(--input-border);
    border-radius: var(--radius-full);
    width: 2.2rem;
    height: 2.2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-color);
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }

  .reaction-btn.active {
    background: var(--primary-soft);
    border-color: var(--ghost-border);
    color: var(--primary);
  }

  /* Tags */
  .tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: var(--surface-soft);
    border: 1px solid var(--input-border);
    border-radius: var(--radius-full);
    padding: 0.25rem 0.6rem;
    font-size: var(--text-sm);
    cursor: pointer;
    color: var(--text-color);
    transition: background var(--transition-fast);
  }

  .tag-chip:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 15%, transparent); border-color: var(--danger); }
  .tag-chip:disabled { opacity: 0.6; cursor: default; }

  .tag-ai {
    font-size: 0.68rem;
    color: var(--muted-text);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-full);
    padding: 0 0.3rem;
  }

  .input-row {
    display: flex;
    gap: var(--space-2);
  }

  input:not([type='number']),
  textarea {
    width: 100%;
    padding: 0.62rem 0.72rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--text-color);
    font-family: inherit;
  }

  input[type='number'] {
    padding: 0.5rem 0.7rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--text-color);
    font-family: inherit;
    width: 100%;
  }

  .form-label {
    display: grid;
    gap: 0.35rem;
    font-size: var(--text-sm);
  }

  /* Score in sidebar */
  .score-display {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .score-num {
    font-size: 2rem;
    font-weight: 700;
    color: var(--primary);
    line-height: 1;
  }

  .score-denom {
    font-size: var(--text-base);
    color: var(--muted-text);
  }

  /* Article text */
  .article-text {
    display: grid;
    gap: 0.85rem;
    line-height: 1.75;
    color: var(--text-color);
  }

  .article-paragraph { margin: 0; }

  .article-list {
    margin: 0;
    padding-left: 1.2rem;
    display: grid;
    gap: 0.35rem;
  }

  .article-heading {
    margin: 0.25rem 0 0;
    font-size: 1.05rem;
    font-weight: 700;
  }

  .key-list {
    margin: 0;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.4rem;
    font-size: var(--text-sm);
    line-height: 1.55;
  }

  /* Source list */
  .source-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .source-list strong { display: block; }

  @media (max-width: 900px) {
    .article-layout {
      grid-template-columns: 1fr;
    }

    .sidebar-col {
      order: -1;
    }

    h1 {
      font-size: var(--text-2xl);
    }
  }
</style>
