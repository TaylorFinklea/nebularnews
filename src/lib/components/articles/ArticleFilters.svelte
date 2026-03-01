<script>
  import { IconFilterX, IconSearch } from '$lib/icons';

  export let query = '';
  export let selectedScores = [];
  export let readFilter = 'all';
  export let sort = 'newest';
  export let view = 'list';
  export let cardLayout = 'split';
  export let selectedReactions = [];
  export let selectedTagIds = [];
  export let availableTags = [];
  export let clearHref = '/articles';
  export let sinceDays = null;

  const DEFAULT_SCORE_FILTER = ['5', '4', '3', '2', '1', 'unscored'];
  const DEFAULT_REACTION_FILTER = ['up', 'none', 'down'];

  $: hasSelections =
    Boolean(query) ||
    readFilter !== 'all' ||
    sort !== 'newest' ||
    view !== 'list' ||
    cardLayout !== 'split' ||
    selectedScores.length !== DEFAULT_SCORE_FILTER.length ||
    selectedReactions.length !== DEFAULT_REACTION_FILTER.length ||
    selectedTagIds.length > 0;
</script>

<form class="filters-shell" method="get">
  {#if sinceDays}
    <input type="hidden" name="sinceDays" value={sinceDays} />
  {/if}

  <div class="filters-head">
    <div class="filters-copy">
      <p class="eyebrow">Refine The Stream</p>
      <h2>Find the next story worth opening.</h2>
      <p>Keep the control surface compact, then let the reading queue do the work.</p>
    </div>

    <div class="filters-actions">
      <button type="submit" class="apply-button">
        <IconSearch size={15} stroke={1.9} />
        <span>Apply</span>
      </button>
      {#if hasSelections}
        <a class="clear-link" href={clearHref} data-sveltekit-reload="true">
          <IconFilterX size={14} stroke={1.9} />
          <span>Clear</span>
        </a>
      {/if}
    </div>
  </div>

  <div class="primary-row">
    <label class="search-field" for="article-search-input">
      <span class="field-label">Search</span>
      <div class="search-input-wrap">
        <IconSearch size={16} stroke={1.9} />
        <input
          id="article-search-input"
          name="q"
          placeholder="Search headlines and summaries"
          bind:value={query}
        />
      </div>
    </label>

    <label class="select-field" for="article-sort-select">
      <span class="field-label">Sort</span>
      <select id="article-sort-select" name="sort" bind:value={sort}>
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="score_desc">Score high to low</option>
        <option value="score_asc">Score low to high</option>
        <option value="unread_first">Unread first</option>
        <option value="title_az">Title A-Z</option>
      </select>
    </label>

    <label class="select-field" for="article-read-select">
      <span class="field-label">Read Status</span>
      <select id="article-read-select" name="read" bind:value={readFilter}>
        <option value="all">All articles</option>
        <option value="unread">Unread only</option>
        <option value="read">Read only</option>
      </select>
    </label>
  </div>

  <div class="cluster-grid">
    <section class="filter-cluster">
      <div class="cluster-head">
        <span class="field-label">AI Score</span>
        <button
          type="button"
          class="reset-button score-all"
          on:click={() => (selectedScores = [...DEFAULT_SCORE_FILTER])}
        >
          All
        </button>
      </div>
      <div class="chip-grid">
        {#each [['5', 'Perfect'], ['4', 'Strong'], ['3', 'Okay'], ['2', 'Weak'], ['1', 'Poor'], ['unscored', 'Unscored']] as [value, label]}
          <label class:active={selectedScores.includes(value)} class="choice-chip">
            <input class="sr-only" type="checkbox" name="score" value={value} bind:group={selectedScores} />
            <span>{label}</span>
          </label>
        {/each}
      </div>
    </section>

    <section class="filter-cluster">
      <div class="cluster-head">
        <span class="field-label">Reactions</span>
        <button
          type="button"
          class="reset-button reaction-all"
          on:click={() => (selectedReactions = [...DEFAULT_REACTION_FILTER])}
        >
          All
        </button>
      </div>
      <div class="chip-grid">
        {#each [['up', 'Up'], ['none', 'None'], ['down', 'Down']] as [value, label]}
          <label class:active={selectedReactions.includes(value)} class="choice-chip compact">
            <input class="sr-only" type="checkbox" name="reaction" value={value} bind:group={selectedReactions} />
            <span>{label}</span>
          </label>
        {/each}
      </div>
    </section>

    <section class="filter-cluster compact-cluster">
      <div class="cluster-head">
        <span class="field-label">Presentation</span>
      </div>
      <div class="segmented-wrap">
        <div class="segmented-group" role="group" aria-label="Article grouping">
          <label class:active={view === 'list'} class="segment-option">
            <input class="sr-only" type="radio" name="view" value="list" bind:group={view} />
            <span>Continuous</span>
          </label>
          <label class:active={view === 'grouped'} class="segment-option">
            <input class="sr-only" type="radio" name="view" value="grouped" bind:group={view} />
            <span>By date</span>
          </label>
        </div>

        <div class="segmented-group" role="group" aria-label="Article card layout">
          <label class:active={cardLayout === 'split'} class="segment-option">
            <input class="sr-only" type="radio" name="layout" value="split" bind:group={cardLayout} />
            <span>Split cards</span>
          </label>
          <label class:active={cardLayout === 'stacked'} class="segment-option">
            <input class="sr-only" type="radio" name="layout" value="stacked" bind:group={cardLayout} />
            <span>Stacked cards</span>
          </label>
        </div>
      </div>
    </section>

    {#if availableTags.length > 0}
      <section class="filter-cluster tag-cluster">
        <div class="cluster-head">
          <label class="field-label" for="article-tags-select">Tags</label>
          <span class="helper-copy">Choose one or more topic chips.</span>
        </div>
        <select id="article-tags-select" name="tags" multiple bind:value={selectedTagIds} size="5">
          {#each availableTags ?? [] as tag}
            <option value={tag.id}>{tag.name} ({tag.article_count})</option>
          {/each}
        </select>
      </section>
    {/if}
  </div>
</form>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .filters-shell {
    min-width: 0;
    display: grid;
    gap: clamp(1rem, 1.7vw, 1.45rem);
    padding: clamp(1rem, 1.8vw, 1.45rem);
    border-radius: var(--radius-md);
    border: 1px solid var(--surface-border);
    background: var(--surface);
    overflow: clip;
  }

  .filters-head,
  .primary-row,
  .cluster-grid,
  .filters-actions,
  .search-input-wrap,
  .segmented-wrap,
  .chip-grid {
    min-width: 0;
  }

  .filters-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .filters-copy {
    min-width: 0;
    display: grid;
    gap: 0.35rem;
    max-width: 36rem;
  }

  .eyebrow,
  .field-label {
    margin: 0;
    font-size: var(--text-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted-text);
  }

  .filters-copy h2,
  .filters-copy p {
    margin: 0;
  }

  .filters-copy h2 {
    font-size: clamp(1.15rem, 1.5vw, 1.45rem);
    line-height: 1.16;
  }

  .filters-copy p:last-child,
  .helper-copy {
    color: var(--muted-text);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

  .filters-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .apply-button,
  .clear-link,
  .reset-button {
    min-height: 40px;
    border-radius: var(--radius-md);
    font: inherit;
  }

  .apply-button {
    border: 0;
    background: var(--button-bg);
    color: var(--button-text);
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.68rem 1rem;
    cursor: pointer;
  }

  .clear-link {
    border: 1px solid var(--surface-border);
    background: transparent;
    color: var(--muted-text);
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.68rem 0.95rem;
    text-decoration: none;
  }

  .primary-row {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) repeat(2, minmax(0, 0.7fr));
    gap: var(--space-3);
  }

  .search-field,
  .select-field {
    min-width: 0;
    display: grid;
    gap: 0.55rem;
  }

  .search-input-wrap,
  select {
    min-width: 0;
    min-height: 3.15rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--text-color);
    box-sizing: border-box;
  }

  .search-input-wrap {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0 0.95rem;
    color: var(--muted-text);
  }

  .search-input-wrap input,
  select {
    width: 100%;
    min-width: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
  }

  .search-input-wrap input:focus,
  select:focus {
    outline: none;
  }

  .cluster-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .filter-cluster {
    min-width: 0;
    display: grid;
    gap: 0.8rem;
    padding: 0.95rem 1rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--surface-border);
    background: var(--surface-soft);
  }

  .compact-cluster {
    align-content: start;
  }

  .cluster-head {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .reset-button {
    border: 1px solid var(--surface-border);
    background: transparent;
    color: var(--muted-text);
    padding: 0.3rem 0.7rem;
    cursor: pointer;
  }

  .chip-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
  }

  .choice-chip,
  .segment-option {
    min-height: 40px;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.55rem 0.9rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--surface-border);
    background: transparent;
    color: var(--muted-text);
    cursor: pointer;
    transition:
      color var(--transition-fast),
      background var(--transition-fast),
      border-color var(--transition-fast);
  }

  .choice-chip.compact {
    min-width: 4.75rem;
  }

  .choice-chip.active,
  .segment-option.active {
    background: var(--primary-soft);
    border-color: var(--primary);
    color: var(--text-color);
  }

  .segmented-wrap {
    display: grid;
    gap: 0.7rem;
  }

  .segmented-group {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
  }

  .tag-cluster {
    grid-column: span 2;
  }

  .tag-cluster select {
    min-height: 9.5rem;
    padding: 0.8rem;
  }

  @media (max-width: 920px) {
    .primary-row,
    .cluster-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .tag-cluster {
      grid-column: auto;
    }
  }

  @media (max-width: 640px) {
    .filters-actions {
      width: 100%;
    }

    .apply-button,
    .clear-link {
      flex: 1 1 10rem;
      justify-content: center;
    }

    .choice-chip,
    .segment-option {
      flex: 1 1 auto;
    }
  }
</style>
