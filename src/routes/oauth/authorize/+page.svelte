<script>
  import Card from '$lib/components/Card.svelte';
  import Button from '$lib/components/Button.svelte';

  export let data;
</script>

<div class="authorize-shell">
  <Card variant="default">
    <h1>Allow MCP access?</h1>
    <p>
      <strong>{data.client.name}</strong> wants read-only access to Nebular News through the public MCP server.
    </p>

    <dl>
      <div>
        <dt>Redirect origin</dt>
        <dd>{data.client.redirectOrigin}</dd>
      </div>
      <div>
        <dt>Scope</dt>
        <dd>{data.authorization.scope}</dd>
      </div>
      <div>
        <dt>Resource</dt>
        <dd>{data.authorization.resource}</dd>
      </div>
    </dl>

    <p class="warning">
      Allowing access lets this client search and read article context from Nebular News. No write tools are exposed.
    </p>

    <form method="post" class="actions">
      <input type="hidden" name="client_id" value={data.authorization.clientId} />
      <input type="hidden" name="redirect_uri" value={data.authorization.redirectUri} />
      <input type="hidden" name="response_type" value={data.authorization.responseType} />
      <input type="hidden" name="scope" value={data.authorization.scope} />
      <input type="hidden" name="resource" value={data.authorization.resource} />
      <input type="hidden" name="code_challenge" value={data.authorization.codeChallenge} />
      <input type="hidden" name="code_challenge_method" value={data.authorization.codeChallengeMethod} />
      {#if data.authorization.state}
        <input type="hidden" name="state" value={data.authorization.state} />
      {/if}
      {#if data.authorization.prompt}
        <input type="hidden" name="prompt" value={data.authorization.prompt} />
      {/if}
      <Button type="submit" name="decision" value="allow">Allow</Button>
      <Button type="submit" variant="ghost" name="decision" value="deny">Deny</Button>
    </form>
  </Card>
</div>

<style>
  .authorize-shell {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 140px);
  }

  .authorize-shell :global(.card) {
    width: min(540px, 100%);
  }

  h1 {
    margin: 0 0 var(--space-3);
  }

  dl {
    display: grid;
    gap: var(--space-3);
    margin: var(--space-5) 0;
  }

  dt {
    font-size: var(--text-sm);
    color: var(--muted-text);
  }

  dd {
    margin: 0.2rem 0 0;
    font-weight: 600;
    word-break: break-word;
  }

  .warning {
    color: var(--muted-text);
    margin: 0 0 var(--space-5);
  }

  .actions {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
</style>
