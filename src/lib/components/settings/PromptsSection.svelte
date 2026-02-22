<script>
  import { IconRestore } from '$lib/icons';

  export let draft;
  export let profile;
  export let onSetField;
  export let onResetDefaults;
</script>

<div class="card" id="fit-score">
  <h2>Prompts and profile</h2>

  <section class="card-section">
    <h3>AI fit score prompt</h3>
    <p class="muted">
      This global prompt controls how relevance is scored for all articles. Variables:
      <code>{'{{profile}}'}</code>, <code>{'{{title}}'}</code>, <code>{'{{url}}'}</code>, <code>{'{{content}}'}</code>.
    </p>
    <label>
      System prompt
      <textarea rows="4" value={draft.scoreSystemPrompt} on:input={(event) => onSetField('scoreSystemPrompt', event.currentTarget.value)}></textarea>
    </label>
    <label>
      User prompt template
      <textarea rows="12" value={draft.scoreUserPromptTemplate} on:input={(event) => onSetField('scoreUserPromptTemplate', event.currentTarget.value)}></textarea>
    </label>
    <p class="muted">Prompt edits are saved with the global Save changes action.</p>
    <div class="row-actions">
      <button class="ghost inline-button" on:click={onResetDefaults}>
        <IconRestore size={16} stroke={1.9} />
        <span>Reset to default</span>
      </button>
    </div>
  </section>

  <div class="divider"></div>

  <section class="card-section" id="profile">
    <h3>AI preference profile</h3>
    <p class="muted">Version {profile.version} · Updated {new Date(profile.updated_at).toLocaleString()}</p>
    <textarea rows="8" value={draft.profileText} on:input={(event) => onSetField('profileText', event.currentTarget.value)}></textarea>
    <p class="muted">Profile edits are saved with the global Save changes action.</p>
  </section>
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

  .card-section {
    display: grid;
    gap: 1rem;
  }

  h3 {
    margin: 0;
    font-size: 1rem;
  }

  label {
    display: grid;
    gap: 0.45rem;
    font-size: 0.9rem;
    min-width: 0;
  }

  textarea {
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

  .inline-button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
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
