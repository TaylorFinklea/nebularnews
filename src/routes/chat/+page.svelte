<script>
  let threadId = null;
  let message = '';
  let chatLog = [];
  let sources = [];
  let sending = false;

  const sendMessage = async () => {
    if (!message) return;
    sending = true;

    if (!threadId) {
      const res = await fetch('/api/chat/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'global', title: 'Global chat' })
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
    sources = response.sources ?? [];
    sending = false;
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
      <button on:click={sendMessage} disabled={sending}>Send</button>
    </div>
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
            <div class="meta">{source.url ?? ''}</div>
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
    background: rgba(255, 255, 255, 0.94);
    padding: 1.5rem;
    border-radius: 20px;
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.08);
  }

  .chat-box {
    background: #f6f1ea;
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
    background: #1f1f1f;
    color: white;
  }

  .bubble.assistant {
    justify-self: start;
    background: white;
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
    border: 1px solid rgba(0, 0, 0, 0.15);
  }

  button {
    background: #1f1f1f;
    color: white;
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 999px;
    cursor: pointer;
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
    color: rgba(0, 0, 0, 0.6);
  }

  .muted {
    color: rgba(0, 0, 0, 0.6);
  }

  @media (max-width: 900px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
