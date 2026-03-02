<script>
  import ArticleUtilities from './ArticleUtilities.svelte';

  export let props = {};

  let lastReact = '';
</script>

<ArticleUtilities
  {...props}
  on:react={(event) => {
    lastReact = JSON.stringify(event.detail);
  }}
/>

<output data-testid="react-detail">{lastReact}</output>
