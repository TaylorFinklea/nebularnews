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
      <form method="post" action="?/apple" class="apple-form">
        <button type="submit" class="apple-btn">
          <svg width="16" height="20" viewBox="0 0 16 20" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M13.13 10.64c-.02-2.17 1.77-3.22 1.85-3.27-1.01-1.48-2.58-1.68-3.14-1.7-1.33-.14-2.6.79-3.27.79-.67 0-1.7-.77-2.8-.75-1.44.02-2.77.84-3.51 2.13C.76 10.58 1.83 14.57 3.4 16.7c.78 1.13 1.71 2.39 2.93 2.34 1.18-.05 1.62-.76 3.05-.76 1.42 0 1.83.76 3.07.73 1.27-.02 2.07-1.14 2.84-2.27.9-1.3 1.27-2.57 1.29-2.63-.03-.01-2.47-.95-2.49-3.47zM10.89 3.8C11.52 3.03 11.95 1.96 11.82.87c-.93.04-2.05.62-2.71 1.38C8.48 2.99 8.0 4.08 8.16 5.11c1.03.08 2.08-.52 2.73-1.31z"/>
          </svg>
          Sign in with Apple
        </button>
      </form>

      <div class="divider"><span>or</span></div>

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

  .apple-form {
    margin-top: var(--space-4);
  }

  .apple-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.7rem 1rem;
    background: #000;
    color: #fff;
    border: none;
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
  }

  .apple-btn:hover {
    background: #1a1a1a;
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
