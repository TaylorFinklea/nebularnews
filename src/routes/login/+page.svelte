<script>
  import Card from '$lib/components/Card.svelte';
  import Button from '$lib/components/Button.svelte';
  export let form;
</script>

<div class="login-shell">
  <Card variant="default">
    <h1>Welcome back</h1>
    <p>Enter the admin password to unlock your Nebular News console.</p>

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
    font-family: 'Source Serif 4', serif;
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

  .error {
    color: var(--danger);
    font-size: var(--text-sm);
  }
</style>
