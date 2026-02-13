<script>
  import { invalidate } from '$app/navigation';
  import { IconThumbDown, IconThumbUp } from '$lib/icons';
  export let data;

  let rating = 3;
  let comment = '';
  let threadId = null;
  let message = '';
  let chatLog = [];
  let sending = false;
  let rerunBusy = false;

  const submitFeedback = async () => {
    await fetch(`/api/articles/${data.article.id}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating, comment, feedId: data.preferredSource?.feedId ?? null })
    });
    comment = '';
    await invalidate();
  };

  const setReaction = async (value) => {
    await fetch(`/api/articles/${data.article.id}/reaction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value, feedId: data.preferredSource?.feedId ?? null })
    });
    await invalidate();
  };

  const sendMessage = async () => {
    if (!message) return;
    sending = true;
    if (!threadId) {
      const res = await fetch('/api/chat/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'article', articleId: data.article.id, title: data.article.title })
      });
      const created = await res.json();
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
    const response = await res.json();
    chatLog = [...chatLog, { role: 'assistant', content: response.response }];
    sending = false;
  };

  const rerunJobs = async (types) => {
    rerunBusy = true;
    await fetch(`/api/articles/${data.article.id}/rerun`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ types })
    });
    rerunBusy = false;
    await invalidate();
  };
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
      <h2>Summary</h2>
      <p>{data.summary?.summary_text ?? 'Summary pending.'}</p>
      {#if data.summary?.provider && data.summary?.model}
        <p class="muted">Latest summary model: {data.summary.provider}/{data.summary.model}</p>
      {/if}
      {#if data.summary?.key_points_json}
        <ul>
          {#each JSON.parse(data.summary.key_points_json) as point}
            <li>{point}</li>
          {/each}
        </ul>
      {/if}
      <button class="ghost" on:click={() => rerunJobs(['summarize'])} disabled={rerunBusy}>
        Re-run summary (pipeline model)
      </button>
      <button class="ghost" on:click={() => rerunJobs(['summarize_chat'])} disabled={rerunBusy}>
        Regenerate with chat model
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
      <div class="chat-box">
        {#each chatLog as entry}
          <div class={`bubble ${entry.role}`}>{entry.content}</div>
        {/each}
      </div>
      <div class="row">
        <input placeholder="Ask about this article" bind:value={message} />
        <button on:click={sendMessage} disabled={sending}>Send</button>
      </div>
    </div>

    <div class="card">
      <h2>Full text</h2>
      <p class="article-text">{data.article.content_text ?? 'Full text pending.'}</p>
    </div>
  </div>
{/if}

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
