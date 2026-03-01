<script>
  import { afterUpdate, createEventDispatcher } from 'svelte';
  import { IconMessage2, IconSend } from '$lib/icons';

  export let chatLog = [];
  export let message = '';
  export let sending = false;
  export let disabled = false;
  export let placeholder = 'Type a message';
  export let error = '';
  export let density = 'default';

  const dispatch = createEventDispatcher();
  let chatContainer;

  afterUpdate(() => {
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  });

  const handleKeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      dispatch('send');
    }
  };
</script>

<div class="chat-wrap" class:density-compact={density === 'compact'}>
  <div class="chat-box" bind:this={chatContainer}>
    {#if chatLog.length === 0 && !sending}
      <div class="chat-empty">
        <IconMessage2 size={32} stroke={1.2} />
        <p>{placeholder}</p>
      </div>
    {:else}
      {#each chatLog as entry}
        <div class={`bubble ${entry.role}`}>{entry.content}</div>
      {/each}
      {#if sending}
        <div class="bubble assistant thinking">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      {/if}
    {/if}
  </div>
  <div class="input-row">
    <input
      {placeholder}
      bind:value={message}
      disabled={disabled || sending}
      on:keydown={handleKeydown}
    />
    <button
      class="send-btn"
      on:click={() => dispatch('send')}
      disabled={sending || disabled || !message.trim()}
      title="Send message"
      aria-label="Send message"
    >
      <IconSend size={16} stroke={1.9} />
    </button>
  </div>
  {#if error}
    <p class="chat-error">{error}</p>
  {/if}
</div>

<style>
  .chat-wrap {
    display: grid;
    gap: var(--space-3);
  }

  .chat-box {
    background: var(--surface-soft);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    display: grid;
    gap: 0.6rem;
    min-height: 320px;
    max-height: 500px;
    overflow-y: auto;
    align-content: start;
  }

  .chat-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    color: var(--muted-text);
    gap: var(--space-3);
    text-align: center;
  }

  .chat-empty p {
    margin: 0;
    font-size: var(--text-base);
  }

  .bubble {
    padding: 0.6rem 0.9rem;
    border-radius: 14px;
    max-width: 80%;
    line-height: 1.5;
    word-break: break-word;
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

  .bubble.thinking {
    display: flex;
    gap: 0.3rem;
    padding: 0.8rem 1rem;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--muted-text);
    animation: bounce 1.2s ease-in-out infinite;
  }

  .dot:nth-child(2) {
    animation-delay: 0.15s;
  }

  .dot:nth-child(3) {
    animation-delay: 0.3s;
  }

  @keyframes bounce {
    0%, 60%, 100% {
      transform: translateY(0);
    }
    30% {
      transform: translateY(-5px);
    }
  }

  .input-row {
    display: flex;
    gap: var(--space-2);
  }

  input {
    flex: 1;
    padding: 0.7rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--text-color);
    font-family: inherit;
  }

  .send-btn {
    width: 2.2rem;
    height: 2.2rem;
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    background: var(--button-bg);
    color: var(--button-text);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: opacity var(--transition-fast);
  }

  .send-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .chat-error {
    color: var(--danger);
    font-size: var(--text-sm);
    margin: 0;
  }

  /* Compact density for utility panels */
  .density-compact .chat-box {
    min-height: 180px;
    max-height: 300px;
    padding: var(--space-3);
  }

  .density-compact .chat-empty {
    min-height: 120px;
  }

  .density-compact .bubble {
    padding: 0.45rem 0.7rem;
    font-size: var(--text-sm);
  }
</style>
