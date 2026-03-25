<script>
  import Card from '$lib/components/Card.svelte';
  import Button from '$lib/components/Button.svelte';
  import { page } from '$app/stores';
  export let data;
  export let form;

  $: isOAuthFlow = ($page.url.searchParams.get('next') ?? '').includes('/oauth/authorize');
  $: callbackError = data?.error;
</script>

<div class="login-shell">
  <Card variant="default">
    <h1>Welcome to Nebular News</h1>

    {#if callbackError}
      <p class="error">Sign in failed: {callbackError}</p>
    {/if}

    {#if isOAuthFlow}
      <p class="oauth-context">Sign in to authorize Nebular News iOS.</p>
    {/if}

    {#if form?.magicLinkSent}
      <div class="success-message">
        <p>Check your email for a sign-in link.</p>
        <p class="muted">We sent a magic link to <strong>{form.magicLinkEmail}</strong></p>
      </div>
    {/if}

    {#if data?.hasSupabase}
      <form method="post" action="?/magiclink">
        <label>
          Email
          <input name="email" type="email" placeholder="you@example.com" required />
        </label>
        {#if form?.magicLinkError}
          <p class="error">{form.magicLinkError}</p>
        {/if}
        <Button type="submit">Sign in with email</Button>
      </form>
    {/if}

    {#if data?.hasSupabase && data?.hasPassword}
      <div class="divider"><span>or</span></div>
    {/if}

    {#if data?.hasPassword}
      <form method="post" action="?/password">
        <label>
          Password
          <input name="password" type="password" required />
        </label>
        {#if form?.error}
          <p class="error">{form.error}</p>
        {/if}
        <Button type="submit" variant={data?.hasSupabase ? 'ghost' : 'primary'}>
          Sign in with password
        </Button>
      </form>
    {/if}
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

  .success-message {
    background: var(--success-bg, rgba(0 200 80 / 0.1));
    border: 1px solid var(--success-border, rgba(0 200 80 / 0.3));
    border-radius: var(--radius-md);
    padding: var(--space-4);
    text-align: center;
  }

  .success-message p {
    margin: 0;
  }

  .muted {
    color: var(--text-muted);
    font-size: var(--text-sm);
    margin-top: var(--space-2);
  }

  .divider {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-sm);
    margin: var(--space-2) 0;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--surface-border);
  }
</style>
