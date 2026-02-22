<script>
  import { IconFilterX, IconSearch } from '$lib/icons';

  export let query = '';
  export let selectedScores = [];
  export let readFilter = 'all';
  export let sort = 'newest';
  export let view = 'list';
  export let selectedReactions = [];
  export let selectedTagIds = [];
  export let availableTags = [];
  export let clearHref = '/articles';
</script>

<form class="filters" method="get">
  <input name="q" placeholder="Search headlines and summaries" bind:value={query} />
  <fieldset class="score-filter">
    <legend>Scores</legend>
    <label>
      <input type="checkbox" name="score" value="5" bind:group={selectedScores} />
      <span>5</span>
    </label>
    <label>
      <input type="checkbox" name="score" value="4" bind:group={selectedScores} />
      <span>4</span>
    </label>
    <label>
      <input type="checkbox" name="score" value="3" bind:group={selectedScores} />
      <span>3</span>
    </label>
    <label>
      <input type="checkbox" name="score" value="2" bind:group={selectedScores} />
      <span>2</span>
    </label>
    <label>
      <input type="checkbox" name="score" value="1" bind:group={selectedScores} />
      <span>1</span>
    </label>
    <label>
      <input type="checkbox" name="score" value="unscored" bind:group={selectedScores} />
      <span>Unscored</span>
    </label>
    <button
      type="button"
      class="score-all ghost"
      on:click={() => (selectedScores = ['5', '4', '3', '2', '1', 'unscored'])}
    >
      All
    </button>
  </fieldset>
  <select name="read" bind:value={readFilter}>
    <option value="all">All articles</option>
    <option value="unread">Unread only</option>
    <option value="read">Read only</option>
  </select>
  <select name="sort" bind:value={sort}>
    <option value="newest">Newest</option>
    <option value="oldest">Oldest</option>
    <option value="score_desc">Score high-low</option>
    <option value="score_asc">Score low-high</option>
    <option value="unread_first">Unread first</option>
    <option value="title_az">Title A-Z</option>
  </select>
  <fieldset class="view-toggle">
    <legend>View</legend>
    <label>
      <input type="radio" name="view" value="list" bind:group={view} />
      <span>List</span>
    </label>
    <label>
      <input type="radio" name="view" value="grouped" bind:group={view} />
      <span>Group by date</span>
    </label>
  </fieldset>
  <fieldset class="reaction-filter">
    <legend>Reactions</legend>
    <label>
      <input type="checkbox" name="reaction" value="up" bind:group={selectedReactions} />
      <span>Up</span>
    </label>
    <label>
      <input type="checkbox" name="reaction" value="none" bind:group={selectedReactions} />
      <span>None</span>
    </label>
    <label>
      <input type="checkbox" name="reaction" value="down" bind:group={selectedReactions} />
      <span>Down</span>
    </label>
    <button
      type="button"
      class="reaction-all ghost"
      on:click={() => (selectedReactions = ['up', 'none', 'down'])}
    >
      All
    </button>
  </fieldset>
  <select name="tags" multiple bind:value={selectedTagIds} size="4">
    {#each availableTags ?? [] as tag}
      <option value={tag.id}>{tag.name} ({tag.article_count})</option>
    {/each}
  </select>
  <button type="submit" class="icon-button" title="Apply filters" aria-label="Apply filters">
    <IconSearch size={16} stroke={1.9} />
    <span class="sr-only">Apply filters</span>
  </button>
  {#if selectedTagIds.length > 0}
    <a class="clear-link icon-link" href={clearHref} title="Clear tag filters">
      <IconFilterX size={14} stroke={1.9} />
      <span>Clear</span>
    </a>
  {/if}
</form>

<style>
  .filters {
    display: flex;
    gap: 0.8rem;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 1.5rem;
  }

  input:not([type='checkbox']),
  select {
    padding: 0.6rem 0.8rem;
    border-radius: 12px;
    border: 1px solid var(--input-border);
    font-family: inherit;
  }

  select {
    min-width: 180px;
  }

  select[multiple] {
    min-width: 230px;
    min-height: 126px;
  }

  form button {
    background: var(--button-bg);
    color: var(--button-text);
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 999px;
    cursor: pointer;
  }

  .icon-button {
    width: 2.2rem;
    height: 2.2rem;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .icon-link {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .clear-link {
    color: var(--muted-text);
    font-size: 0.9rem;
  }

  .score-filter,
  .reaction-filter,
  .view-toggle {
    border: 1px solid var(--input-border);
    border-radius: 12px;
    padding: 0.45rem 0.6rem;
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.55rem;
    min-width: 260px;
  }

  .score-filter legend,
  .reaction-filter legend,
  .view-toggle legend {
    font-size: 0.75rem;
    color: var(--muted-text);
    padding: 0 0.25rem;
  }

  .score-filter label,
  .reaction-filter label,
  .view-toggle label {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.82rem;
    color: var(--muted-text);
  }

  .score-filter input[type='checkbox'],
  .reaction-filter input[type='checkbox'] {
    margin: 0;
    accent-color: var(--primary);
  }

  .view-toggle input[type='radio'] {
    margin: 0;
    accent-color: var(--primary);
  }

  .score-all,
  .reaction-all {
    margin-left: auto;
    border: 1px solid var(--ghost-border);
    background: transparent;
    color: var(--ghost-color);
    cursor: pointer;
    border-radius: 999px;
    padding: 0.18rem 0.55rem;
    font-size: 0.78rem;
    line-height: 1.2;
  }

  @media (max-width: 700px) {
    .filters {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
