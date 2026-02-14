<script>
  import { IconExternalLink, IconSend } from '$lib/icons';
  let threadId = null;
  let message = '';
  let chatLog = [];
  let sources = [];
  let sending = false;
  let chatError = '';

  const sendMessage = async () => {
    if (!message) return;
    sending = true;
    chatError = '';
    try {
      if (!threadId) {
        const res = await fetch('/api/chat/threads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: 'global', title: 'Global chat' })
        });
        const created = await res.json().catch(() => ({}));
        if (!res.ok || !created?.id) {
          chatError = created?.error ?? 'Failed to start chat';
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
      sources = response.sources ?? [];
    } catch {
      chatError = 'Chat request failed';
    } finally {
      sending = false;
    }
  };
</script>

<section class="page-header">
  <div>
    <h1>Global Chat</h1>
    <p>Ask questions across your entire archive of articles.</p>
  </div>
</section>

<div class="grid">
  <div class="card">
    <div class="chat-box">
      {#each chatLog as entry}
        <div class={`bubble ${entry.role}`}>{entry.content}</div>
      {/each}
    </div>
    <div class="row">
      <input placeholder="Ask about recent stories" bind:value={message} />
      <button
        class="icon-button"
        on:click={sendMessage}
        disabled={sending}
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
    <h2>Sources used</h2>
    {#if sources.length === 0}
      <p class="muted">No sources yet. Ask a question to pull context.</p>
    {:else}
      <ul>
        {#each sources as source}
          <li>
            <strong>{source.title ?? 'Untitled'}</strong>
            {#if source.url}
              <a class="source-link" href={source.url} target="_blank" rel="noopener noreferrer" title="Open source article">
                <IconExternalLink size={14} stroke={1.9} />
                <span class="sr-only">Open source article</span>
              </a>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 1.5rem;
  }

  .card {
    background: var(--surface-strong);
    padding: 1.5rem;
    border-radius: 20px;
    box-shadow: 0 12px 24px var(--shadow-color);
    border: 1px solid var(--surface-border);
  }

  .chat-box {
    background: var(--surface-soft);
    border-radius: 16px;
    padding: 1rem;
    display: grid;
    gap: 0.6rem;
    min-height: 260px;
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

  input {
    width: 100%;
    padding: 0.7rem;
    border-radius: 12px;
    border: 1px solid var(--input-border);
  }

  button {
    background: var(--button-bg);
    color: var(--button-text);
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 999px;
    cursor: pointer;
  }

  .icon-button {
    width: 2.2rem;
    height: 2.2rem;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.8rem;
  }

  .meta {
    font-size: 0.85rem;
    color: var(--muted-text);
  }

  .source-link {
    margin-left: 0.45rem;
    display: inline-flex;
    color: var(--primary);
    vertical-align: middle;
  }

  .muted {
    color: var(--muted-text);
  }

  @media (max-width: 900px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
