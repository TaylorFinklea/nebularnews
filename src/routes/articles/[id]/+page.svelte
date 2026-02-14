<script>
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import { IconThumbDown, IconThumbUp } from '$lib/icons';
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
      <h1>{data.article.title ?? 'Untitled article'}</h1>
      <p class="meta">
        Source: {data.preferredSource?.sourceName ?? 'Unknown source'}
        {#if data.preferredSource?.feedbackCount}
          · rep {data.preferredSource.reputation.toFixed(2)} ({data.preferredSource.feedbackCount} votes)
        {/if}
      </p>
      <p class="meta">Author: {data.article.author ?? 'Unknown author'} · {data.article.canonical_url}</p>
    </div>
  </section>

  <div class="grid">
    <div class="card">
      <h2>Read Status</h2>
      <div class="read-row">
        <span class={`status-pill ${data.article.is_read ? 'ok' : 'warn'}`}>
          {data.article.is_read ? 'Read' : 'Unread'}
        </span>
        <button class="ghost" on:click={() => setReadState(!data.article.is_read)} disabled={readStateBusy}>
          {data.article.is_read ? 'Mark unread' : 'Mark read'}
        </button>
      </div>
    </div>

    <div class="card">
      <h2>Tags</h2>
      {#if data.tags?.length}
        <div class="tag-row">
          {#each data.tags as tag}
            <button class="tag-pill removable" on:click={() => removeTag(tag.id)} disabled={tagBusy}>
              <span>{tag.name}</span>
              {#if tag.source === 'ai'}
                <span class="tag-source">AI</span>
              {/if}
              <span class="x">x</span>
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
        <button class="ghost" on:click={addTags} disabled={tagBusy}>Add tags</button>
      </div>
      <button class="ghost" on:click={() => rerunJobs(['auto_tag'])} disabled={rerunBusy}>
        Generate AI tags (uses Auto Tagging setting)
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
      <button class="ghost" on:click={() => rerunJobs(['summarize'])} disabled={rerunBusy}>
        Re-run summary (uses Summaries setting)
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
      <button class="ghost" on:click={() => rerunJobs(['key_points'])} disabled={rerunBusy}>
        Generate key points (uses Key Points setting)
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
      <button class="ghost" on:click={() => rerunJobs(['score'])} disabled={rerunBusy}>
        Re-run score
      </button>
    </div>

    <div class="card">
      <h2>Feed Vote</h2>
      <p class="muted">
        Use thumbs to tune source reputation. This does not edit the AI relevance score.
      </p>
      <div class="reaction-row">
        <button class:active={data.reaction?.value === 1} on:click={() => setReaction(1)}>
          <IconThumbUp size={16} stroke={1.9} />
          <span>Thumbs up</span>
        </button>
        <button class:active={data.reaction?.value === -1} on:click={() => setReaction(-1)}>
          <IconThumbDown size={16} stroke={1.9} />
          <span>Thumbs down</span>
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
      <button on:click={submitFeedback}>Submit feedback</button>
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
        <button on:click={sendMessage} disabled={sending || !data.chatReadiness?.canChat}>Send</button>
      </div>
      {#if chatError}
        <p class="muted">{chatError}</p>
      {/if}
    </div>

    <div class="card">
      <h2>Full text</h2>
      <p class="article-text">{data.article.content_text ?? 'Full text pending.'}</p>
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

  .score {
    font-weight: 600;
    color: var(--primary);
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
    gap: 0.35rem;
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

  .tag-pill .x {
    color: var(--muted-text);
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
    white-space: pre-line;
    line-height: 1.6;
    color: var(--text-color);
  }
</style>
