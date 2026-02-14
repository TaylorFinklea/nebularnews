<script>
  import { invalidateAll } from '$app/navigation';
  export let data;

  let search = data.q ?? '';
  $: search = data.q ?? '';

  let createName = '';
  let createColor = '';
  let createDescription = '';

  let selectedTagId = '';
  let editName = '';
  let editColor = '';
  let editDescription = '';
  let clearEditColor = false;

  let mergeSourceId = '';
  let mergeTargetId = '';
  let mergeDeleteSource = true;

  let reassignFromId = '';
  let reassignToId = '';
  let reassignKeepFrom = false;

  let busy = false;
  let message = '';

  const selectedTag = () => data.tags?.find((tag) => tag.id === selectedTagId) ?? null;

  const pickTag = (tag) => {
    selectedTagId = tag.id;
    editName = tag.name ?? '';
    editColor = tag.color ?? '';
    editDescription = tag.description ?? '';
    clearEditColor = false;
  };

  const normalizeColor = (value) => {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return null;
    return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : undefined;
  };

  const run = async (label, fn) => {
    busy = true;
    message = '';
    try {
      await fn();
      message = `${label} completed.`;
      await invalidateAll();
    } catch (err) {
      message = err instanceof Error ? err.message : `${label} failed.`;
    } finally {
      busy = false;
    }
  };

  const createTag = async () => {
    await run('Create tag', async () => {
      const color = normalizeColor(createColor);
      if (createColor.trim() && color === undefined) {
        throw new Error('Color must look like #12abef');
      }
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: createName,
          color,
          description: createDescription || null
        })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? 'Create tag failed');
      createName = '';
      createColor = '';
      createDescription = '';
    });
  };

  const updateTag = async () => {
    if (!selectedTagId) return;
    await run('Update tag', async () => {
      const color = clearEditColor ? null : normalizeColor(editColor);
      if (!clearEditColor && editColor.trim() && color === undefined) {
        throw new Error('Color must look like #12abef');
      }
      const res = await fetch(`/api/tags/${selectedTagId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          color,
          description: editDescription
        })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? 'Update tag failed');
    });
  };

  const deleteTag = async (tagId) => {
    await run('Delete tag', async () => {
      const res = await fetch(`/api/tags/${tagId}`, { method: 'DELETE' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? 'Delete tag failed');
      if (selectedTagId === tagId) {
        selectedTagId = '';
        editName = '';
        editColor = '';
        editDescription = '';
        clearEditColor = false;
      }
    });
  };

  const mergeTags = async () => {
    await run('Merge tags', async () => {
      if (!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId) {
        throw new Error('Select different source and target tags');
      }
      const res = await fetch('/api/tags/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceTagId: mergeSourceId,
          targetTagId: mergeTargetId,
          deleteSource: mergeDeleteSource
        })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? 'Merge failed');
      mergeSourceId = '';
      mergeTargetId = '';
    });
  };

  const reassignTags = async () => {
    await run('Reassign tags', async () => {
      if (!reassignFromId || !reassignToId || reassignFromId === reassignToId) {
        throw new Error('Select different from/to tags');
      }
      const res = await fetch('/api/tags/reassign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fromTagId: reassignFromId,
          toTagId: reassignToId,
          keepFrom: reassignKeepFrom
        })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? 'Reassign failed');
      reassignFromId = '';
      reassignToId = '';
    });
  };
</script>

<section class="page-header">
  <div>
    <h1>Tags</h1>
    <p>Create, edit, merge, delete, and bulk reassign tags.</p>
  </div>
</section>

<form class="search-row" method="get">
  <input name="q" placeholder="Search tags by name or slug" bind:value={search} />
  <button type="submit">Search</button>
  {#if data.q}
    <a class="clear-link" href="/tags">Clear</a>
  {/if}
</form>

{#if message}
  <p class="message">{message}</p>
{/if}

<div class="grid">
  <div class="card">
    <h2>Create Tag</h2>
    <label>
      Name
      <input bind:value={createName} placeholder="e.g. AI Safety" />
    </label>
    <label>
      Color (optional, #RRGGBB)
      <input bind:value={createColor} placeholder="#7d7fff" />
    </label>
    <label>
      Description (optional)
      <textarea rows="3" bind:value={createDescription}></textarea>
    </label>
    <button on:click|preventDefault={createTag} disabled={busy}>Create tag</button>
  </div>

  <div class="card">
    <h2>Edit Tag</h2>
    <label>
      Choose tag
      <select bind:value={selectedTagId}>
        <option value="">Select a tag</option>
        {#each data.tags as tag}
          <option value={tag.id}>{tag.name}</option>
        {/each}
      </select>
    </label>
    {#if selectedTag()}
      <label>
        Name
        <input bind:value={editName} />
      </label>
      <label>
        Color (#RRGGBB)
        <input bind:value={editColor} disabled={clearEditColor} />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={clearEditColor} />
        <span>Clear color</span>
      </label>
      <label>
        Description
        <textarea rows="3" bind:value={editDescription}></textarea>
      </label>
      <button on:click|preventDefault={updateTag} disabled={busy}>Save tag</button>
    {:else}
      <p class="muted">Select a tag first.</p>
    {/if}
  </div>

  <div class="card">
    <h2>Merge Tags</h2>
    <label>
      Source tag (will be moved)
      <select bind:value={mergeSourceId}>
        <option value="">Select source</option>
        {#each data.tags as tag}
          <option value={tag.id}>{tag.name}</option>
        {/each}
      </select>
    </label>
    <label>
      Target tag
      <select bind:value={mergeTargetId}>
        <option value="">Select target</option>
        {#each data.tags as tag}
          <option value={tag.id}>{tag.name}</option>
        {/each}
      </select>
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={mergeDeleteSource} />
      <span>Delete source tag after merge</span>
    </label>
    <button on:click|preventDefault={mergeTags} disabled={busy}>Merge</button>
  </div>

  <div class="card">
    <h2>Bulk Reassign</h2>
    <p class="muted">Moves article tag usage from one tag to another across all articles.</p>
    <label>
      From tag
      <select bind:value={reassignFromId}>
        <option value="">Select from</option>
        {#each data.tags as tag}
          <option value={tag.id}>{tag.name}</option>
        {/each}
      </select>
    </label>
    <label>
      To tag
      <select bind:value={reassignToId}>
        <option value="">Select to</option>
        {#each data.tags as tag}
          <option value={tag.id}>{tag.name}</option>
        {/each}
      </select>
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={reassignKeepFrom} />
      <span>Keep source tag record</span>
    </label>
    <button on:click|preventDefault={reassignTags} disabled={busy}>Reassign</button>
  </div>

  <div class="card span-two">
    <h2>All Tags</h2>
    {#if data.tags.length === 0}
      <p class="muted">No tags yet.</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Articles</th>
              <th>Color</th>
              <th>Description</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each data.tags as tag}
              <tr>
                <td>{tag.name}</td>
                <td>{tag.slug}</td>
                <td>{tag.article_count}</td>
                <td>
                  {#if tag.color}
                    <span class="swatch" style={`background:${tag.color}`}></span>
                    <code>{tag.color}</code>
                  {:else}
                    <span class="muted">—</span>
                  {/if}
                </td>
                <td>{tag.description ?? '—'}</td>
                <td>
                  <div class="actions">
                    <button class="ghost" on:click|preventDefault={() => pickTag(tag)} disabled={busy}>Edit</button>
                    <button class="ghost danger" on:click|preventDefault={() => deleteTag(tag.id)} disabled={busy}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 1.2rem;
  }

  .card {
    background: var(--surface-strong);
    padding: 1.25rem;
    border-radius: 18px;
    box-shadow: 0 12px 24px var(--shadow-color);
    border: 1px solid var(--surface-border);
    display: grid;
    gap: 0.7rem;
  }

  .span-two {
    grid-column: 1 / -1;
  }

  .search-row {
    margin-bottom: 1rem;
    display: flex;
    gap: 0.55rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .search-row input {
    min-width: 300px;
    flex: 1;
  }

  label {
    display: grid;
    gap: 0.35rem;
    min-width: 0;
  }

  input,
  select,
  textarea {
    width: 100%;
    padding: 0.62rem 0.72rem;
    border-radius: 10px;
    border: 1px solid var(--input-border);
  }

  button {
    border: none;
    border-radius: 999px;
    padding: 0.55rem 0.95rem;
    background: var(--button-bg);
    color: var(--button-text);
    cursor: pointer;
  }

  button.ghost {
    background: transparent;
    color: var(--ghost-color);
    border: 1px solid var(--ghost-border);
  }

  button.danger {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 45%, transparent);
  }

  button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .check input {
    width: auto;
  }

  .message {
    color: var(--muted-text);
  }

  .clear-link {
    color: var(--muted-text);
    font-size: 0.9rem;
  }

  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 860px;
  }

  th,
  td {
    text-align: left;
    padding: 0.6rem 0.5rem;
    border-bottom: 1px solid var(--surface-border);
    vertical-align: top;
  }

  th {
    font-size: 0.85rem;
    text-transform: uppercase;
    color: var(--muted-text);
  }

  .swatch {
    display: inline-block;
    width: 0.9rem;
    height: 0.9rem;
    border-radius: 999px;
    margin-right: 0.4rem;
    border: 1px solid var(--surface-border);
    vertical-align: middle;
  }

  .actions {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .muted {
    color: var(--muted-text);
  }
</style>
