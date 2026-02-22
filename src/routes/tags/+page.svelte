<script>
  import { invalidateAll } from '$app/navigation';
  import { apiFetch } from '$lib/client/api-fetch';
  import {
    IconArrowsTransferUpDown,
    IconDeviceFloppy,
    IconEdit,
    IconFilterX,
    IconPlus,
    IconSearch,
    IconTrash
  } from '$lib/icons';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Card from '$lib/components/Card.svelte';
  import Button from '$lib/components/Button.svelte';
  import { showToast } from '$lib/client/toast';
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
    try {
      await fn();
      showToast(`${label} completed.`, 'success');
      await invalidateAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : `${label} failed.`, 'error');
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
      const res = await apiFetch('/api/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: createName, color, description: createDescription || null })
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
      const res = await apiFetch(`/api/tags/${selectedTagId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: editName, color, description: editDescription })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? 'Update tag failed');
    });
  };

  const deleteTag = async (tagId) => {
    await run('Delete tag', async () => {
      const res = await apiFetch(`/api/tags/${tagId}`, { method: 'DELETE' });
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
      const res = await apiFetch('/api/tags/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceTagId: mergeSourceId, targetTagId: mergeTargetId, deleteSource: mergeDeleteSource })
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
      const res = await apiFetch('/api/tags/reassign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromTagId: reassignFromId, toTagId: reassignToId, keepFrom: reassignKeepFrom })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? 'Reassign failed');
      reassignFromId = '';
      reassignToId = '';
    });
  };
</script>

<PageHeader title="Tags" description="Create, edit, merge, delete, and bulk reassign tags." />

<form class="search-row" method="get">
  <input name="q" placeholder="Search tags by name or slug" bind:value={search} />
  <Button type="submit" size="icon" title="Search tags">
    <IconSearch size={16} stroke={1.9} />
  </Button>
  {#if data.q}
    <a class="clear-link icon-link" href="/tags">
      <IconFilterX size={14} stroke={1.9} />
      <span>Clear</span>
    </a>
  {/if}
</form>

<div class="grid">
  <Card>
    <h2>Create Tag</h2>
    <label>Name <input bind:value={createName} placeholder="e.g. AI Safety" /></label>
    <label>Color (optional, #RRGGBB) <input bind:value={createColor} placeholder="#7d7fff" /></label>
    <label>Description (optional) <textarea rows="3" bind:value={createDescription}></textarea></label>
    <Button size="inline" on:click={createTag} disabled={busy}>
      <IconPlus size={16} stroke={1.9} />
      <span>Create tag</span>
    </Button>
  </Card>

  <Card>
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
      <label>Name <input bind:value={editName} /></label>
      <label>Color (#RRGGBB) <input bind:value={editColor} disabled={clearEditColor} /></label>
      <label class="check">
        <input type="checkbox" bind:checked={clearEditColor} />
        <span>Clear color</span>
      </label>
      <label>Description <textarea rows="3" bind:value={editDescription}></textarea></label>
      <Button size="inline" on:click={updateTag} disabled={busy}>
        <IconDeviceFloppy size={16} stroke={1.9} />
        <span>Save changes</span>
      </Button>
    {:else}
      <p class="muted">Select a tag above to edit it.</p>
    {/if}
  </Card>

  <Card>
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
    <Button size="inline" on:click={mergeTags} disabled={busy}>
      <IconArrowsTransferUpDown size={16} stroke={1.9} />
      <span>Merge</span>
    </Button>
  </Card>

  <Card>
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
    <Button size="inline" on:click={reassignTags} disabled={busy}>
      <IconArrowsTransferUpDown size={16} stroke={1.9} />
      <span>Reassign</span>
    </Button>
  </Card>

  <div class="span-full">
    <Card>
      <div class="table-head">
        <h2>All Tags</h2>
        <span class="count">{data.tags.length} tags</span>
      </div>
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
                  <td><strong>{tag.name}</strong></td>
                  <td class="mono">{tag.slug}</td>
                  <td>{tag.article_count}</td>
                  <td>
                    {#if tag.color}
                      <span class="swatch" style={`background:${tag.color}`}></span>
                      <code>{tag.color}</code>
                    {:else}
                      <span class="muted">—</span>
                    {/if}
                  </td>
                  <td class="desc">{tag.description ?? '—'}</td>
                  <td>
                    <div class="actions">
                      <Button
                        variant="ghost"
                        size="icon"
                        on:click={() => pickTag(tag)}
                        disabled={busy}
                        title="Edit tag"
                      >
                        <IconEdit size={15} stroke={1.9} />
                      </Button>
                      <Button
                        variant="danger"
                        size="icon"
                        on:click={() => deleteTag(tag.id)}
                        disabled={busy}
                        title="Delete tag"
                      >
                        <IconTrash size={15} stroke={1.9} />
                      </Button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Card>
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: var(--space-5);
  }

  .span-full {
    grid-column: 1 / -1;
  }

  .search-row {
    margin-bottom: var(--space-5);
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }

  .search-row input {
    min-width: 280px;
    flex: 1;
    padding: 0.65rem 0.8rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--text-color);
    font-family: inherit;
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  label {
    display: grid;
    gap: 0.35rem;
    font-size: var(--text-sm);
    font-weight: 500;
  }

  input:not([type='checkbox']),
  select,
  textarea {
    width: 100%;
    padding: 0.62rem 0.72rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--text-color);
    font-family: inherit;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: var(--text-sm);
  }

  .check input {
    width: auto;
  }

  .clear-link {
    color: var(--muted-text);
    font-size: var(--text-sm);
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .table-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .count {
    background: var(--surface-soft);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-full);
    padding: 0.1rem 0.55rem;
    font-size: var(--text-sm);
    color: var(--muted-text);
    font-weight: 600;
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
    vertical-align: middle;
  }

  th {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted-text);
    font-weight: 600;
  }

  .swatch {
    display: inline-block;
    width: 0.85rem;
    height: 0.85rem;
    border-radius: var(--radius-full);
    margin-right: 0.4rem;
    border: 1px solid var(--surface-border);
    vertical-align: middle;
  }

  .mono {
    font-family: monospace;
    font-size: var(--text-sm);
  }

  .desc {
    max-width: 240px;
    color: var(--muted-text);
    font-size: var(--text-sm);
  }

  .actions {
    display: flex;
    gap: 0.35rem;
  }

  .muted {
    color: var(--muted-text);
    margin: 0;
  }
</style>
