<script>
  import { invalidateAll } from '$app/navigation';
  import { apiFetch } from '$lib/client/api-fetch';
  import { showToast } from '$lib/client/toast';
  import Card from '$lib/components/Card.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { IconTrash } from '$lib/icons';

  export let data;

  let users = data.users ?? [];
  let updatingUserId = '';

  const formatDate = (ts) => {
    if (!ts) return 'Never';
    return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const toggleRole = async (user) => {
    if (user.id === data.currentUserId) {
      showToast('Cannot change your own role.', 'error');
      return;
    }
    updatingUserId = user.id;
    const newRole = user.role === 'admin' ? 'member' : 'admin';
    try {
      const res = await apiFetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: newRole })
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        showToast(payload?.error ?? 'Failed to update role.', 'error');
        return;
      }
      users = users.map((u) => (u.id === user.id ? { ...u, role: newRole } : u));
      showToast(`${user.display_name || user.email || user.id} is now ${newRole}.`, 'success');
    } catch {
      showToast('Failed to update role.', 'error');
    } finally {
      updatingUserId = '';
    }
  };

  const deleteUser = async (user) => {
    if (user.id === data.currentUserId) {
      showToast('Cannot delete yourself.', 'error');
      return;
    }
    if (!confirm(`Delete ${user.display_name || user.email || user.id}? This removes all their data.`)) return;
    updatingUserId = user.id;
    try {
      const res = await apiFetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        showToast(payload?.error ?? 'Failed to delete user.', 'error');
        return;
      }
      users = users.filter((u) => u.id !== user.id);
      showToast('User deleted.', 'success');
    } catch {
      showToast('Failed to delete user.', 'error');
    } finally {
      updatingUserId = '';
    }
  };
</script>

<PageHeader title="Users" description="Manage who has access to your Nebular News instance.">
  <svelte:fragment slot="actions">
    <a href="/settings" class="back-link">Back to Settings</a>
  </svelte:fragment>
</PageHeader>

<div class="users-grid">
  {#each users as user (user.id)}
    <Card>
      <div class="user-header">
        <div>
          <h3>{user.display_name || user.email || user.id}</h3>
          {#if user.email}
            <p class="muted">{user.email}</p>
          {/if}
        </div>
        <span class="role-badge {user.role}">{user.role}</span>
      </div>

      <div class="user-meta">
        <span>Provider: {user.auth_provider}</span>
        <span>Joined: {formatDate(user.created_at)}</span>
        <span>Last login: {formatDate(user.last_login_at)}</span>
      </div>

      <div class="user-actions">
        <Button
          variant="ghost"
          size="inline"
          on:click={() => toggleRole(user)}
          disabled={updatingUserId === user.id || user.id === data.currentUserId}
        >
          {user.role === 'admin' ? 'Demote to member' : 'Promote to admin'}
        </Button>

        {#if user.id !== data.currentUserId && user.id !== 'admin'}
          <Button
            variant="danger"
            size="icon"
            on:click={() => deleteUser(user)}
            disabled={updatingUserId === user.id}
            title="Delete user"
          >
            <IconTrash size={15} stroke={1.9} />
          </Button>
        {/if}
      </div>
    </Card>
  {/each}

  {#if users.length === 0}
    <p class="muted">No users found.</p>
  {/if}
</div>

<style>
  .users-grid {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 var(--space-4);
    display: grid;
    gap: var(--space-4);
    margin-top: var(--space-5);
  }

  .user-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  .user-header h3 {
    margin: 0;
    font-size: var(--text-base);
  }

  .role-badge {
    font-size: var(--text-xs);
    padding: 0.2rem 0.6rem;
    border-radius: var(--radius-full);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .role-badge.admin {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
  }

  .role-badge.member {
    background: var(--surface-soft);
    color: var(--text-muted);
  }

  .user-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .user-actions {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .muted {
    color: var(--text-muted);
    font-size: var(--text-sm);
    margin: 0;
  }

  .back-link {
    color: var(--accent);
    text-decoration: none;
    font-size: var(--text-sm);
  }
</style>
