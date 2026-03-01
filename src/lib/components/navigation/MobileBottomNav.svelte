<script lang="ts">
  import { tick } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import {
    IconArticle,
    IconClockPlay,
    IconLayoutDashboard,
    IconMenu2,
    IconMessage2,
    IconMoonStars,
    IconRss,
    IconSettings,
    IconSun,
    IconTag
  } from '$lib/icons';
  import { APP_NAV_ITEMS, isAppNavItemActive, type AppNavItem, type AppNavItemIcon } from '$lib/navigation/app-nav';

  export let currentPath = '/';
  export let theme: 'dark' | 'light' = 'dark';
  export let onToggleTheme: () => void = () => {};

  let moreOpen = false;
  /** @type {HTMLAnchorElement[]} */
  let moreItemRefs: HTMLAnchorElement[] = [];

  const iconByName: Record<AppNavItemIcon, typeof IconLayoutDashboard> = {
    layoutDashboard: IconLayoutDashboard,
    article: IconArticle,
    message: IconMessage2,
    settings: IconSettings,
    tag: IconTag,
    rss: IconRss,
    clockPlay: IconClockPlay
  };

  const primaryItems = APP_NAV_ITEMS.filter((item) => item.mobilePrimary);
  const moreItems = APP_NAV_ITEMS.filter((item) => item.group === 'workspace');
  const isActive = (item: AppNavItem) => isAppNavItemActive(item, currentPath);
  const themeLabel = () => (theme === 'dark' ? 'Light mode' : 'Dark mode');

  const closeMore = () => {
    moreOpen = false;
  };

  const toggleMore = async () => {
    moreOpen = !moreOpen;
    if (!moreOpen) return;
    await tick();
    moreItemRefs[0]?.focus();
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !moreOpen) return;
    event.preventDefault();
    closeMore();
  };

  const handleThemeToggle = () => {
    onToggleTheme();
    closeMore();
  };

  $: currentPath, closeMore();
</script>

<svelte:window on:keydown={handleKeydown} />

<nav class="bottom-rail" aria-label="Bottom navigation">
  {#each primaryItems as item}
    {@const Icon = iconByName[item.icon]}
    {@const active = isActive(item)}
    <a
      href={item.href}
      class="rail-link"
      class:active
      aria-current={active ? 'page' : undefined}
    >
      <span class="rail-icon"><Icon size={20} stroke={1.9} /></span>
      <span class="rail-label">{item.label}</span>
    </a>
  {/each}
  <button
    type="button"
    class="rail-link more-trigger"
    class:active={moreOpen}
    aria-label="More navigation"
    aria-expanded={moreOpen}
    on:click={toggleMore}
  >
    <span class="rail-icon"><IconMenu2 size={20} stroke={1.9} /></span>
    <span class="rail-label">More</span>
  </button>
</nav>

{#if moreOpen}
  <button
    class="more-overlay"
    aria-label="Close more navigation"
    on:click={closeMore}
    transition:fade={{ duration: 150 }}
  ></button>
  <dialog
    class="more-sheet"
    open
    aria-modal="true"
    aria-label="More navigation"
    transition:fly={{ y: 120, duration: 250, easing: cubicOut }}
  >
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="sheet-header">Workspace</div>
    <div class="sheet-links">
      {#each moreItems as item, index}
        {@const Icon = iconByName[item.icon]}
        {@const active = isActive(item)}
        <a
          bind:this={moreItemRefs[index]}
          href={item.href}
          class="sheet-link"
          class:active
          aria-current={active ? 'page' : undefined}
          on:click={closeMore}
        >
          <Icon size={18} stroke={1.9} />
          <span>{item.label}</span>
        </a>
      {/each}
      <button type="button" class="sheet-link" on:click={handleThemeToggle}>
        {#if theme === 'dark'}
          <IconSun size={18} stroke={1.9} />
        {:else}
          <IconMoonStars size={18} stroke={1.9} />
        {/if}
        <span>{themeLabel()}</span>
      </button>
    </div>
  </dialog>
{/if}

<style>
  /* ── Bottom rail ── */
  .bottom-rail {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 100;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    padding: var(--space-1) var(--space-2) calc(var(--space-1) + env(safe-area-inset-bottom));
    border-top: 1px solid var(--surface-border);
    background: var(--surface-strong);
    backdrop-filter: blur(14px);
    height: calc(var(--mobile-nav-height) + env(safe-area-inset-bottom));
    box-sizing: border-box;
  }

  /* ── Rail links (stacked icon + label) ── */
  .rail-link {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    position: relative;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted-text);
    cursor: pointer;
    padding: var(--space-1) 0;
    min-height: 2.8rem;
    font: inherit;
    -webkit-tap-highlight-color: transparent;
    transition:
      color 0.15s ease,
      background 0.15s ease;
  }

  .rail-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
  }

  .rail-label {
    font-size: 0.65rem;
    font-weight: 500;
    letter-spacing: 0.02em;
    line-height: 1;
  }

  /* Active top accent line */
  .rail-link::before {
    content: '';
    position: absolute;
    top: 0;
    left: 25%;
    right: 25%;
    height: 2.5px;
    border-radius: 0 0 2px 2px;
    background: var(--primary);
    opacity: 0;
    transform: scaleX(0.4);
    transition:
      opacity 0.15s ease,
      transform 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .rail-link.active {
    color: var(--primary);
  }

  .rail-link.active::before {
    opacity: 1;
    transform: scaleX(1);
  }

  /* Touch press feedback */
  .rail-link:active {
    background: var(--primary-soft);
    transition-duration: 0s;
  }

  /* ── More overlay ── */
  .more-overlay {
    position: fixed;
    inset: 0;
    z-index: 101;
    border: none;
    background: rgba(0, 0, 0, 0.44);
    cursor: pointer;
  }

  /* ── More sheet ── */
  .more-sheet {
    position: fixed;
    left: var(--space-3);
    right: var(--space-3);
    bottom: calc(var(--mobile-nav-height) + env(safe-area-inset-bottom) + var(--space-2));
    z-index: 102;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-lg);
    background: var(--surface-strong);
    backdrop-filter: blur(16px);
    box-shadow: var(--shadow-lg);
    padding: var(--space-3) var(--space-4) var(--space-4);
    display: grid;
    gap: var(--space-3);
  }

  .sheet-handle {
    width: 32px;
    height: 3px;
    border-radius: var(--radius-full);
    background: var(--surface-border);
    margin: 0 auto var(--space-1);
  }

  .sheet-header {
    font-size: var(--text-sm);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted-text);
  }

  .sheet-links {
    display: grid;
    gap: var(--space-1);
  }

  .sheet-link {
    width: 100%;
    font: inherit;
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    border-radius: var(--radius-md);
    border: none;
    background: transparent;
    color: var(--text-color);
    padding: var(--space-3);
    cursor: pointer;
    text-align: left;
    -webkit-tap-highlight-color: transparent;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }

  .sheet-link:active {
    background: var(--primary-soft);
    transition-duration: 0s;
  }

  .sheet-link.active {
    color: var(--primary);
    font-weight: 500;
  }

  /* ── Hide on desktop ── */
  @media (min-width: 801px) {
    .bottom-rail,
    .more-overlay,
    .more-sheet {
      display: none;
    }
  }
</style>
