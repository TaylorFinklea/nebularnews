<script>
  import { IconDeviceFloppy, IconRefresh, IconTrash } from '$lib/icons';

  export let keyMap;
  export let keyInputs;
  export let onSetKeyInput;
  export let onSaveKey;
  export let onRemoveKey;
  export let onRotateKeys;
</script>

<div class="card" id="keys">
  <h2>API Keys</h2>
  <div class="row key-rotate-row">
    <button class="ghost inline-button" on:click={() => onRotateKeys()}>
      <IconRefresh size={16} stroke={1.9} />
      <span>Rotate key ciphers</span>
    </button>
  </div>
  <div class="key-row">
    <div>
      <strong>OpenAI</strong>
      <p class="muted">{keyMap.openai ? 'Key stored' : 'No key yet'}</p>
    </div>
    <button class="ghost icon-button" on:click={() => onRemoveKey('openai')} title="Remove OpenAI key" aria-label="Remove OpenAI key">
      <IconTrash size={16} stroke={1.9} />
      <span class="sr-only">Remove OpenAI key</span>
    </button>
  </div>
  <input
    type="password"
    placeholder="Paste OpenAI key"
    value={keyInputs.openai}
    on:input={(event) => onSetKeyInput('openai', event.currentTarget.value)}
  />
  <button on:click={() => onSaveKey('openai')} class="inline-button">
    <IconDeviceFloppy size={16} stroke={1.9} />
    <span>Save OpenAI key</span>
  </button>

  <div class="divider"></div>

  <div class="key-row">
    <div>
      <strong>Anthropic</strong>
      <p class="muted">{keyMap.anthropic ? 'Key stored' : 'No key yet'}</p>
    </div>
    <button class="ghost icon-button" on:click={() => onRemoveKey('anthropic')} title="Remove Anthropic key" aria-label="Remove Anthropic key">
      <IconTrash size={16} stroke={1.9} />
      <span class="sr-only">Remove Anthropic key</span>
    </button>
  </div>
  <input
    type="password"
    placeholder="Paste Anthropic key"
    value={keyInputs.anthropic}
    on:input={(event) => onSetKeyInput('anthropic', event.currentTarget.value)}
  />
  <button on:click={() => onSaveKey('anthropic')} class="inline-button">
    <IconDeviceFloppy size={16} stroke={1.9} />
    <span>Save Anthropic key</span>
  </button>
</div>

<style>
  .card {
    background: var(--surface-strong);
    padding: 1.8rem;
    border-radius: 20px;
    box-shadow: 0 12px 24px var(--shadow-color);
    border: 1px solid var(--surface-border);
    display: grid;
    gap: 1rem;
    align-content: start;
    min-width: 0;
  }

  .key-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  .key-rotate-row {
    margin-bottom: 0.8rem;
  }

  input {
    width: 100%;
    padding: 0.7rem;
    border-radius: 12px;
    border: 1px solid var(--input-border);
    min-width: 0;
    max-width: 100%;
  }

  button {
    background: var(--button-bg);
    color: var(--button-text);
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 999px;
    cursor: pointer;
    max-width: 100%;
    white-space: normal;
    line-height: 1.25;
  }

  .ghost {
    background: transparent;
    border: 1px solid var(--ghost-border);
    color: var(--ghost-color);
  }

  .icon-button {
    width: 2.1rem;
    height: 2.1rem;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .inline-button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .divider {
    height: 1px;
    background: var(--surface-border);
    margin: 0.8rem 0;
  }

  .muted {
    color: var(--muted-text);
    font-size: 0.85rem;
  }

  @media (max-width: 900px) {
    .card {
      padding: 1.25rem;
    }
  }
</style>
