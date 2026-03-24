<script>
  import { onMount, tick } from 'svelte';
  import { apiFetch } from '$lib/client/api-fetch';
  import { showToast } from '$lib/client/toast';
  import Card from '$lib/components/Card.svelte';

  export let articleId;

  let messages = [];
  let inputText = '';
  let isSending = false;
  let isLoading = true;
  let messagesEnd;

  const scrollToBottom = async () => {
    await tick();
    messagesEnd?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadChat = async () => {
    try {
      const res = await apiFetch(`/api/articles/${articleId}/chat`);
      if (res.ok) {
        const data = await res.json();
        messages = data.messages ?? [];
      }
    } catch {
      // silent — empty state is fine
    } finally {
      isLoading = false;
    }
  };

  const sendMessage = async () => {
    const content = inputText.trim();
    if (!content || isSending) return;

    isSending = true;
    const savedInput = inputText;
    inputText = '';

    // Optimistic user message
    const tempId = `temp-${Date.now()}`;
    messages = [...messages, { id: tempId, role: 'user', content, created_at: Date.now() / 1000 }];
    await scrollToBottom();

    try {
      const res = await apiFetch(`/api/articles/${articleId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        messages = messages.filter((m) => m.id !== tempId);
        inputText = savedInput;
        showToast(data?.error ?? 'Chat failed', 'error');
        return;
      }
      messages = data.messages ?? [];
      await scrollToBottom();
    } catch {
      messages = messages.filter((m) => m.id !== tempId);
      inputText = savedInput;
      showToast('Failed to send message', 'error');
    } finally {
      isSending = false;
    }
  };

  const handleKeydown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  onMount(() => {
    loadChat();
  });
</script>

<Card id="chat">
  <h2>Chat</h2>

  <div class="chat-messages">
    {#if isLoading}
      <p class="muted center">Loading…</p>
    {:else if messages.length === 0 && !isSending}
      <p class="muted center">Ask a question about this article</p>
    {/if}

    {#each messages as message (message.id)}
      <div class="bubble {message.role}">
        <div class="bubble-content">{message.content}</div>
      </div>
    {/each}

    {#if isSending}
      <div class="bubble assistant">
        <div class="bubble-content thinking">Thinking…</div>
      </div>
    {/if}

    <div bind:this={messagesEnd}></div>
  </div>

  <div class="compose">
    <textarea
      bind:value={inputText}
      on:keydown={handleKeydown}
      placeholder="Ask about this article…"
      rows="1"
      disabled={isSending}
    ></textarea>
    <button
      on:click={sendMessage}
      disabled={!inputText.trim() || isSending}
      class="send-button"
      title="Send message"
    >
      ↑
    </button>
  </div>
</Card>

<style>
  .chat-messages {
    max-height: 400px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-2) 0;
  }

  .bubble {
    display: flex;
    max-width: 85%;
  }

  .bubble.user {
    align-self: flex-end;
  }

  .bubble.assistant {
    align-self: flex-start;
  }

  .bubble-content {
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    font-size: var(--text-sm);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .bubble.user .bubble-content {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
  }

  .bubble.assistant .bubble-content {
    background: var(--surface-soft);
    color: var(--text-primary);
  }

  .thinking {
    font-style: italic;
    opacity: 0.7;
  }

  .compose {
    display: flex;
    gap: var(--space-2);
    align-items: flex-end;
  }

  textarea {
    flex: 1;
    resize: none;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--surface);
    color: var(--text-primary);
    font-size: var(--text-sm);
    font-family: inherit;
    line-height: 1.4;
    min-height: 2.5rem;
    max-height: 8rem;
    overflow-y: auto;
  }

  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .send-button {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    border: none;
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    font-size: 1.1rem;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .send-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .center {
    text-align: center;
    padding: var(--space-6) 0;
  }

  .muted {
    color: var(--muted-text);
    font-size: var(--text-sm);
  }
</style>
