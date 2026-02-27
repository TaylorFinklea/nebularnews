<script lang="ts">
  import { tick } from 'svelte';
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
  let firstMoreAction: HTMLAnchorElement | null = null;

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
  const moreItems = APP_NAV_ITEMS.filter((item) => item.group === 'manage');
  const isActive = (item: AppNavItem) => isAppNavItemActive(item, currentPath);
  const themeLabel = () => (theme === 'dark' ? 'Light mode' : 'Dark mode');

  const closeMore = () => {
    moreOpen = false;
  };

  const toggleMore = async () => {
    moreOpen = !moreOpen;
    if (!moreOpen) return;
    await tick();
    firstMoreAction?.focus();
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
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      title={item.label}
    >
      <Icon size={20} stroke={1.9} />
      <span class="sr-only">{item.label}</span>
    </a>
  {/each}
  <button
    type="button"
    class="rail-link more-trigger"
    class:active={moreOpen}
    aria-label="More navigation"
    aria-expanded={moreOpen}
    title="More"
    on:click={toggleMore}
  >
    <IconMenu2 size={20} stroke={1.9} />
    <span class="sr-only">More navigation</span>
  </button>
</nav>

{#if moreOpen}
  <button class="more-overlay" aria-label="Close more navigation" on:click={closeMore}></button>
  <dialog class="more-sheet" open aria-modal="true" aria-label="More navigation">
    <div class="sheet-header">More</div>
    <div class="sheet-links">
      {#each moreItems as item, index}
        {@const Icon = iconByName[item.icon]}
        {@const active = isActive(item)}
        {#if index === 0}
          <a
            bind:this={firstMoreAction}
            href={item.href}
            class="sheet-link"
            class:active
            aria-current={active ? 'page' : undefined}
            on:click={closeMore}
          >
            <Icon size={18} stroke={1.9} />
            <span>{item.label}</span>
          </a>
        {:else}
          <a
            href={item.href}
            class="sheet-link"
            class:active
            aria-current={active ? 'page' : undefined}
            on:click={closeMore}
          >
            <Icon size={18} stroke={1.9} />
            <span>{item.label}</span>
          </a>
        {/if}
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
  .bottom-rail {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 100;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3) calc(var(--space-2) + env(safe-area-inset-bottom));
    border-top: 1px solid var(--surface-border);
    background: var(--surface-strong);
    backdrop-filter: blur(14px);
    height: calc(var(--mobile-nav-height) + env(safe-area-inset-bottom));
    box-sizing: border-box;
  }

  .rail-link {
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--muted-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    min-height: 2.45rem;
    transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
  }

  .rail-link.active {
    color: var(--primary);
    background: var(--primary-soft);
    border-color: var(--ghost-border);
  }

  .more-overlay {
    position: fixed;
    inset: 0;
    z-index: 101;
    border: none;
    background: rgba(0, 0, 0, 0.44);
    cursor: pointer;
  }

  .more-sheet {
    position: fixed;
    left: var(--space-3);
    right: var(--space-3);
    bottom: calc(var(--mobile-nav-height) + env(safe-area-inset-bottom) + var(--space-2));
    z-index: 102;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-lg);
    background: var(--surface-strong);
    box-shadow: var(--shadow-lg);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }

  .sheet-header {
    font-size: var(--text-sm);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted-text);
  }

  .sheet-links {
    display: grid;
    gap: var(--space-2);
  }

  .sheet-link {
    width: 100%;
    font: inherit;
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-color);
    padding: var(--space-3) var(--space-3);
    cursor: pointer;
    text-align: left;
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }

  .sheet-link:hover {
    background: var(--primary-soft);
  }

  .sheet-link.active {
    background: var(--primary-soft);
    border-color: var(--ghost-border);
    color: var(--primary);
    font-weight: 600;
  }

  @media (min-width: 801px) {
    .bottom-rail,
    .more-overlay,
    .more-sheet {
      display: none;
    }
  }
</style>
