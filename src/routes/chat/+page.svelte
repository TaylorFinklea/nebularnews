<script>
  import { apiFetch } from '$lib/client/api-fetch';
  import { IconExternalLink } from '$lib/icons';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Card from '$lib/components/Card.svelte';
  import ChatBox from '$lib/components/ChatBox.svelte';

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
        const res = await apiFetch('/api/chat/threads', {
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

      const res = await apiFetch(`/api/chat/threads/${threadId}/messages`, {
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

<PageHeader title="Global Chat" description="Ask questions across your entire archive of articles." />

<div class="grid">
  <Card>
    <ChatBox
      {chatLog}
      bind:message
      {sending}
      placeholder="Ask about recent stories"
      error={chatError}
      on:send={sendMessage}
    />
  </Card>

  <Card>
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
  </Card>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: var(--space-6);
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-3);
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
