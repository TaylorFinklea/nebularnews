<script>
  export let form;
</script>

<div class="login-shell">
  <div class="card">
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
      <button type="submit">Sign in</button>
    </form>
  </div>
</div>

<style>
  .login-shell {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 140px);
  }

  .card {
    background: rgba(255, 255, 255, 0.9);
    padding: 2.5rem;
    border-radius: 24px;
    width: min(420px, 100%);
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
  }

  h1 {
    font-family: 'Source Serif 4', serif;
    margin-top: 0;
  }

  form {
    display: grid;
    gap: 1rem;
    margin-top: 1.5rem;
  }

  input {
    width: 100%;
    padding: 0.7rem 0.8rem;
    border-radius: 12px;
    border: 1px solid rgba(0, 0, 0, 0.15);
  }

  button {
    background: #c55b2a;
    color: white;
    border: none;
    padding: 0.8rem 1rem;
    border-radius: 999px;
    font-weight: 600;
    cursor: pointer;
  }

  .error {
    color: #b42318;
    font-size: 0.9rem;
  }
</style>
