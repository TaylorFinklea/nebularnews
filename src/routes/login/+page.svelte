<script>
  import Card from '$lib/components/Card.svelte';
  import Button from '$lib/components/Button.svelte';
  import { page } from '$app/stores';
  export let form;

  $: isOAuthFlow = ($page.url.searchParams.get('next') ?? '').includes('/oauth/authorize');
</script>

<div class="login-shell">
  <Card variant="default">
    <h1>Welcome back</h1>
    {#if isOAuthFlow}
      <p class="oauth-context">Enter your admin password to authorize Nebular News iOS.</p>
    {:else}
      <p>Enter the admin password to unlock your Nebular News console.</p>
    {/if}

    <form method="post">
      <label>
        Password
        <input name="password" type="password" required />
      </label>
      {#if form?.error}
        <p class="error">{form.error}</p>
      {/if}
      <Button type="submit">Sign in</Button>
    </form>
  </Card>
</div>

<style>
  .login-shell {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 140px);
  }

  .login-shell :global(.card) {
    width: min(420px, 100%);
  }

  h1 {
    margin-top: 0;
  }

  form {
    display: grid;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }

  input {
    width: 100%;
    padding: 0.7rem 0.8rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--text-color);
    font-family: inherit;
  }

  .oauth-context {
    font-size: var(--text-sm);
    color: var(--text-muted);
    background: var(--surface-2, rgba(0 0 0 / 0.05));
    border-left: 3px solid var(--accent, currentColor);
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-sm);
    margin: 0;
  }

  .error {
    color: var(--danger);
    font-size: var(--text-sm);
  }
</style>
