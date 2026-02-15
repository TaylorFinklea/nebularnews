<script>
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { resolveArticleImageUrl } from '$lib/article-image';
  import {
    IconArrowLeft,
    IconCheck,
    IconEye,
    IconEyeOff,
    IconExternalLink,
    IconFileText,
    IconListDetails,
    IconPlus,
    IconSend,
    IconSparkles,
    IconStars,
    IconTag,
    IconThumbDown,
    IconThumbUp,
    IconX
  } from '$lib/icons';
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
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'");

  const htmlToMarkdownish = (html) => {
    if (!html) return '';
    return decodeHtmlEntities(
      String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<(h[1-6])[^>]*>/gi, '\n\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<li[^>]*>/gi, '\n- ')
        .replace(/<\/li>/gi, '')
        .replace(/<\/(p|div|section|article|blockquote|ul|ol|pre|table|tr)>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    );
  };

  const splitLongParagraph = (text) => {
    const compact = text.trim();
    if (compact.length < 520) return [compact];
    const sentences = compact
      .match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean);
    if (!sentences || sentences.length < 4) return [compact];
    const groups = [];
    for (let i = 0; i < sentences.length; i += 3) {
      groups.push(sentences.slice(i, i + 3).join(' '));
    }
    return groups;
  };

  const parseArticleBlocks = (text) => {
    if (!text) return [];
    const normalized = String(text).replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
    if (!normalized) return [];

    return normalized
      .split(/\n{2,}/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const lines = chunk
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length === 0) return null;

        if (lines.length === 1 && /^#{1,6}\s+/.test(lines[0])) {
          const headingText = lines[0].replace(/^#{1,6}\s+/, '').trim();
          if (!headingText) return null;
          return {
            type: 'heading',
            text: headingText
          };
        }

        const bulletLines = lines.filter((line) => /^(?:[-*•]\s+|\d+[.)]\s+)/.test(line));
        if (bulletLines.length >= Math.max(2, Math.ceil(lines.length * 0.6))) {
          return {
            type: 'list',
            items: bulletLines.map((line) => line.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '').trim()).filter(Boolean)
          };
        }

        const paragraph = lines.join(' ');
        const chunks = splitLongParagraph(paragraph);
        if (chunks.length === 1) {
          return {
            type: 'paragraph',
            text: chunks[0]
          };
        }
        return {
          type: 'paragraph_group',
          paragraphs: chunks
        };
      })
      .filter(Boolean);
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
    await fetch(`/api/articles/${data.article.id}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating, comment, feedId: data.preferredSource?.feedId ?? null })
    });
    comment = '';
    await invalidateAll();
  };

  const setReaction = async (value) => {
    await fetch(`/api/articles/${data.article.id}/reaction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value, feedId: data.preferredSource?.feedId ?? null })
    });
    await invalidateAll();
  };

  const sendMessage = async () => {
    if (!data.chatReadiness?.canChat) {
      chatError = data.chatReadiness?.reasons?.[0] ?? 'Chat is not ready yet.';
      return;
    }
    if (!message) return;
    sending = true;
    chatError = '';
    try {
      if (!threadId) {
        const threadRes = await fetch('/api/chat/threads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: 'article', articleId: data.article.id, title: data.article.title })
        });
        const created = await threadRes.json().catch(() => ({}));
        if (!threadRes.ok || !created?.id) {
          chatError = created?.error ?? 'Failed to start article chat';
          return;
        }
        threadId = created.id;
      }

      const userText = message;
      chatLog = [...chatLog, { role: 'user', content: userText }];
      message = '';

      const res = await fetch(`/api/chat/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: userText })
      });
      const response = await res.json().catch(() => ({}));
      if (!res.ok) {
        chatError = response?.error ?? 'Chat request failed';
        return;
      }
      chatLog = [...chatLog, { role: 'assistant', content: response.response }];
    } catch {
      chatError = 'Chat request failed';
    } finally {
      sending = false;
    }
  };

  const rerunJobs = async (types) => {
    rerunBusy = true;
    await fetch(`/api/articles/${data.article.id}/rerun`, {
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
      await fetch(`/api/articles/${data.article.id}/read`, {
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
    const names = tagInput
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    tagBusy = true;
    tagError = '';
    try {
      const res = await fetch(`/api/articles/${data.article.id}/tags`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ addTagNames: names, source: 'manual' })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        tagError = payload?.error ?? 'Failed to add tags';
        return;
      }
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
      const res = await fetch(`/api/articles/${data.article.id}/tags`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ removeTagIds: [tagId] })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        tagError = payload?.error ?? 'Failed to remove tag';
      }
    } finally {
      tagBusy = false;
      await invalidateAll();
    }
  };

  onMount(() => {
    if (data.article && !data.article.is_read) {
      autoReadTimer = setTimeout(() => {
        if (!data.article?.is_read) {
          void setReadState(true);
        }
      }, AUTO_MARK_READ_DELAY_MS);
    }
    return () => {
      if (autoReadTimer) clearTimeout(autoReadTimer);
    };
  });
</script>

{#if !data.article}
  <p>Article not found.</p>
{:else}
  <section class="page-header">
    <div>
      <a
        class="ghost back-link icon-link"
        href={backHref}
        title="Back to articles"
        aria-label="Back to articles"
        data-sveltekit-reload="true"
      >
        <IconArrowLeft size={16} stroke={1.9} />
        <span>Back to list</span>
      </a>
      <h1>{data.article.title ?? 'Untitled article'}</h1>
      <p class="meta">
        Source: {data.preferredSource?.sourceName ?? 'Unknown source'}
        {#if data.preferredSource?.feedbackCount}
          · rep {data.preferredSource.reputation.toFixed(2)} ({data.preferredSource.feedbackCount} votes)
        {/if}
      </p>
      <p class="meta">Author: {data.article.author ?? 'Unknown author'}</p>
      {#if data.article.canonical_url}
        <a
          class="source-link-button icon-link"
          href={data.article.canonical_url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open original article"
        >
          <IconExternalLink size={15} stroke={1.9} />
          <span>Open article</span>
        </a>
      {/if}
    </div>
  </section>

  <div class="article-hero-wrap">
    <img class="article-hero-image" src={articleImageUrl} alt="" decoding="async" />
  </div>

  <div class="grid">
    <div class="card">
      <h2>Read Status</h2>
      <div class="read-row">
        <span class={`status-pill ${data.article.is_read ? 'ok' : 'warn'}`}>
          {data.article.is_read ? 'Read' : 'Unread'}
        </span>
        <button
          class="ghost icon-button"
          on:click={() => setReadState(!data.article.is_read)}
          disabled={readStateBusy}
          title={data.article.is_read ? 'Mark unread' : 'Mark read'}
          aria-label={data.article.is_read ? 'Mark unread' : 'Mark read'}
        >
          {#if data.article.is_read}
            <IconEyeOff size={16} stroke={1.9} />
            <span class="sr-only">Mark unread</span>
          {:else}
            <IconEye size={16} stroke={1.9} />
            <span class="sr-only">Mark read</span>
          {/if}
        </button>
      </div>
    </div>

    <div class="card">
      <h2>Tags</h2>
      {#if data.tags?.length}
        <div class="tag-row">
          {#each data.tags as tag}
            <button
              class="tag-pill removable"
              on:click={() => removeTag(tag.id)}
              disabled={tagBusy}
              title={`Remove tag ${tag.name}`}
              aria-label={`Remove tag ${tag.name}`}
            >
              <span>{tag.name}</span>
              {#if tag.source === 'ai'}
                <span class="tag-source">AI</span>
              {/if}
              <IconX size={12} stroke={2} />
              <span class="sr-only">Remove {tag.name}</span>
            </button>
          {/each}
        </div>
      {:else}
        <p class="muted">No tags yet.</p>
      {/if}
      <div class="row">
        <input
          list="article-tag-options"
          placeholder="Add tag (or comma-separated tags)"
          bind:value={tagInput}
          disabled={tagBusy}
        />
        <button class="ghost icon-button" on:click={addTags} disabled={tagBusy} title="Add tags" aria-label="Add tags">
          <IconPlus size={16} stroke={1.9} />
          <span class="sr-only">Add tags</span>
        </button>
      </div>
      <button class="ghost inline-button" on:click={() => rerunJobs(['auto_tag'])} disabled={rerunBusy}>
        <IconTag size={16} stroke={1.9} />
        <span>AI tags</span>
      </button>
      <p class="muted">Tip: type a new tag name to create it.</p>
      {#if tagError}
        <p class="muted">{tagError}</p>
      {/if}
    </div>

    <div class="card">
      <h2>Summary</h2>
      <p>{data.summary?.summary_text ?? 'Summary pending.'}</p>
      {#if data.summary?.provider && data.summary?.model}
        <p class="muted">Latest summary model: {data.summary.provider}/{data.summary.model}</p>
      {/if}
      <button class="ghost inline-button" on:click={() => rerunJobs(['summarize'])} disabled={rerunBusy}>
        <IconFileText size={16} stroke={1.9} />
        <span>Rebuild summary</span>
      </button>
    </div>

    <div class="card">
      <h2>Key Points</h2>
      {#if data.keyPoints?.key_points_json}
        <ul>
          {#each JSON.parse(data.keyPoints.key_points_json) as point}
            <li>{point}</li>
          {/each}
        </ul>
      {:else}
        <p class="muted">No key points generated yet.</p>
      {/if}
      {#if data.keyPoints?.provider && data.keyPoints?.model}
        <p class="muted">Latest key points model: {data.keyPoints.provider}/{data.keyPoints.model}</p>
      {/if}
      <button class="ghost inline-button" on:click={() => rerunJobs(['key_points'])} disabled={rerunBusy}>
        <IconListDetails size={16} stroke={1.9} />
        <span>Key points</span>
      </button>
    </div>

    <div class="card">
      <h2>AI Fit Score</h2>
      {#if data.score}
        <div class="score">{data.score.score} / 5 · {data.score.label}</div>
        <p>{data.score.reason_text}</p>
        {#if data.score.evidence_json}
          <ul>
            {#each JSON.parse(data.score.evidence_json) as evidence}
              <li>{evidence}</li>
            {/each}
          </ul>
        {/if}
      {:else}
        <p>Score pending.</p>
      {/if}
      <button class="ghost inline-button" on:click={() => rerunJobs(['score'])} disabled={rerunBusy}>
        <IconStars size={16} stroke={1.9} />
        <span>Re-score</span>
      </button>
    </div>

    <div class="card">
      <h2>Feed Vote</h2>
      <p class="muted">
        Use thumbs to tune source reputation. This does not edit the AI relevance score.
      </p>
      <div class="reaction-row">
        <button
          class:active={data.reaction?.value === 1}
          on:click={() => setReaction(1)}
          title="Thumbs up feed"
          aria-label="Thumbs up feed"
        >
          <IconThumbUp size={16} stroke={1.9} />
          <span class="sr-only">Thumbs up feed</span>
        </button>
        <button
          class:active={data.reaction?.value === -1}
          on:click={() => setReaction(-1)}
          title="Thumbs down feed"
          aria-label="Thumbs down feed"
        >
          <IconThumbDown size={16} stroke={1.9} />
          <span class="sr-only">Thumbs down feed</span>
        </button>
      </div>
    </div>

    <div class="card">
      <h2>Feedback</h2>
      <label>
        Rating (1-5)
        <input type="number" min="1" max="5" bind:value={rating} />
      </label>
      <textarea rows="4" placeholder="What did the AI miss?" bind:value={comment}></textarea>
      <button on:click={submitFeedback} class="inline-button">
        <IconCheck size={16} stroke={1.9} />
        <span>Save feedback</span>
      </button>
    </div>

    <div class="card">
      <h2>Source Ranking</h2>
      {#if data.sources?.length}
        <ul>
          {#each data.sources as source}
            <li>
              <strong>{source.sourceName}</strong>
              <span>rep {source.reputation.toFixed(2)} ({source.feedbackCount} votes)</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p>No feed source metadata yet.</p>
      {/if}
    </div>

    <div class="card">
      <h2>Chat with this article</h2>
      <div class="readiness">
        <span class={`status-pill ${data.chatReadiness?.canChat ? 'ok' : 'warn'}`}>
          {data.chatReadiness?.canChat ? 'Ready' : 'Needs setup'}
        </span>
        <div class="readiness-meta">
          <div>Lane: {data.chatReadiness?.selectedLane ?? 'unknown'}</div>
          <div>Context: {data.chatReadiness?.hasArticleContext ? 'ok' : 'missing'}</div>
          <div>Model: {data.chatReadiness?.hasModelConfig ? 'ok' : 'missing'}</div>
          <div>API key: {data.chatReadiness?.hasAnyProviderKey ? 'ok' : 'missing'}</div>
        </div>
        {#if data.chatReadiness?.modelCandidates?.length}
          <div class="muted">
            Models:
            {#each data.chatReadiness.modelCandidates as candidate, index}
              {candidate.provider}/{candidate.model}{index < data.chatReadiness.modelCandidates.length - 1 ? ' · ' : ''}
            {/each}
          </div>
        {/if}
        {#if data.chatReadiness?.reasons?.length}
          <div class="muted">{data.chatReadiness.reasons.join(' ')}</div>
        {/if}
      </div>
      <div class="chat-box">
        {#each chatLog as entry}
          <div class={`bubble ${entry.role}`}>{entry.content}</div>
        {/each}
      </div>
      <div class="row">
        <input
          placeholder={data.chatReadiness?.canChat ? 'Ask about this article' : 'Complete chat setup first'}
          bind:value={message}
          disabled={!data.chatReadiness?.canChat}
        />
        <button
          on:click={sendMessage}
          disabled={sending || !data.chatReadiness?.canChat}
          class="icon-button"
          title="Send message"
          aria-label="Send message"
        >
          <IconSend size={16} stroke={1.9} />
          <span class="sr-only">Send message</span>
        </button>
      </div>
      {#if chatError}
        <p class="muted">{chatError}</p>
      {/if}
    </div>

    <div class="card">
      <h2>Full text</h2>
      <div class="article-text">
        {#if articleBlocks.length === 0}
          <p class="muted">Full text pending.</p>
        {:else}
          {#each articleBlocks as block}
            {#if block.type === 'list'}
              <ul class="article-list">
                {#each block.items as item}
                  <li>{item}</li>
                {/each}
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
    </div>
  </div>
{/if}

<datalist id="article-tag-options">
  {#each data.availableTags ?? [] as tag}
    <option value={tag.name}></option>
  {/each}
</datalist>

<style>
  .grid {
    display: grid;
    gap: 1.5rem;
  }

  .card {
    background: var(--surface-strong);
    padding: 1.5rem;
    border-radius: 20px;
    box-shadow: 0 12px 24px var(--shadow-color);
    border: 1px solid var(--surface-border);
  }

  .meta {
    color: var(--muted-text);
  }

  .source-link-button {
    margin-top: 0.7rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--button-bg);
    color: var(--button-text);
    border-radius: 999px;
    padding: 0.48rem 0.95rem;
    font-size: 0.88rem;
    font-weight: 600;
  }

  .score {
    font-weight: 600;
    color: var(--primary);
  }

  .article-hero-wrap {
    margin: 0 0 1.2rem;
    border-radius: 18px;
    overflow: hidden;
    border: 1px solid var(--surface-border);
    background: var(--surface-soft);
  }

  .article-hero-image {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    display: block;
  }

  .card ul {
    margin-top: 0.8rem;
    padding-left: 1.1rem;
  }

  .card li {
    margin: 0.35rem 0;
  }

  .card li span {
    margin-left: 0.4rem;
    font-size: 0.85rem;
    color: var(--muted-text);
  }

  input,
  textarea {
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.7rem;
    border-radius: 12px;
    border: 1px solid var(--input-border);
  }

  button {
    margin-top: 0.7rem;
    background: var(--button-bg);
    color: var(--button-text);
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 999px;
    cursor: pointer;
  }

  .reaction-row {
    display: flex;
    gap: 0.6rem;
  }

  .reaction-row button {
    margin-top: 0;
    background: var(--surface-soft);
    color: var(--text-color);
    border: 1px solid var(--input-border);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.1rem;
    height: 2.1rem;
    padding: 0;
  }

  .reaction-row button.active {
    border-color: var(--ghost-border);
    background: var(--primary-soft);
    color: var(--primary);
  }

  .tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .tag-pill {
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
    color: var(--text-color);
    border-radius: 999px;
    padding: 0.3rem 0.6rem;
    font-size: 0.82rem;
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
  }

  .tag-pill.removable {
    margin-top: 0;
    cursor: pointer;
  }

  .inline-button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    width: fit-content;
  }

  .icon-button {
    width: 2.15rem;
    height: 2.15rem;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .icon-link {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .back-link {
    margin-bottom: 0.8rem;
    width: fit-content;
  }

  .tag-source {
    font-size: 0.72rem;
    color: var(--muted-text);
    border: 1px solid var(--surface-border);
    border-radius: 999px;
    padding: 0.05rem 0.35rem;
  }

  .ghost {
    background: transparent;
    border: 1px solid var(--ghost-border);
    color: var(--ghost-color);
  }

  .chat-box {
    background: var(--surface-soft);
    border-radius: 16px;
    padding: 1rem;
    display: grid;
    gap: 0.6rem;
    max-height: 260px;
    overflow-y: auto;
  }

  .readiness {
    margin-bottom: 0.8rem;
    display: grid;
    gap: 0.35rem;
  }

  .status-pill {
    justify-self: start;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .status-pill.ok {
    background: rgba(114, 236, 200, 0.18);
    color: #91f0cd;
  }

  .status-pill.warn {
    background: rgba(255, 110, 150, 0.2);
    color: #ff9dbc;
  }

  .read-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  .readiness-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
    font-size: 0.85rem;
    color: var(--muted-text);
  }

  .bubble {
    padding: 0.6rem 0.8rem;
    border-radius: 14px;
    max-width: 80%;
  }

  .bubble.user {
    justify-self: end;
    background: var(--button-bg);
    color: var(--button-text);
  }

  .bubble.assistant {
    justify-self: start;
    background: var(--surface-strong);
  }

  .row {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.8rem;
  }

  .article-text {
    display: grid;
    gap: 0.85rem;
    max-width: 78ch;
    line-height: 1.7;
    color: var(--text-color);
  }

  .article-paragraph {
    margin: 0;
  }

  .article-list {
    margin: 0;
    padding-left: 1.2rem;
    display: grid;
    gap: 0.35rem;
  }

  .article-heading {
    margin: 0.25rem 0 0;
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-color);
  }
</style>
