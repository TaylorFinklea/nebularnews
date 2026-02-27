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
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      title={item.label}
    >
      <span class="rail-icon"><Icon size={20} stroke={1.9} /></span>
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
    <span class="rail-icon"><IconMenu2 size={20} stroke={1.9} /></span>
    <span class="sr-only">More navigation</span>
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
    left: 50%;
    bottom: calc(var(--mobile-nav-offset, 12px) + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 100;
    width: min(26rem, calc(100vw - 1rem));
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.35rem;
    padding: 0.45rem;
    border: 1px solid rgba(149, 164, 255, 0.14);
    border-radius: 999px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 55%),
      var(--surface-strong);
    backdrop-filter: blur(22px) saturate(145%);
    box-shadow:
      0 18px 42px rgba(2, 6, 24, 0.22),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    min-height: var(--mobile-nav-height, 70px);
    box-sizing: border-box;
  }

  /* ── Rail links ── */
  .rail-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative;
    min-width: 0;
    min-height: 3rem;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--muted-text);
    cursor: pointer;
    padding: 0;
    font: inherit;
    -webkit-tap-highlight-color: transparent;
    transition:
      transform 0.15s ease,
      color 0.15s ease,
      background 0.15s ease,
      border-color 0.15s ease,
      box-shadow 0.18s ease;
  }

  .rail-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.35rem;
    height: 2.35rem;
    border-radius: 999px;
    transition:
      background 0.15s ease,
      color 0.15s ease,
      transform 0.15s ease,
      box-shadow 0.18s ease;
  }

  .rail-link:hover {
    color: var(--text-color);
    background: rgba(154, 139, 255, 0.07);
    border-color: rgba(149, 164, 255, 0.12);
  }

  .rail-link.active {
    color: var(--primary-contrast);
    border-color: rgba(154, 139, 255, 0.16);
    background:
      linear-gradient(135deg, var(--primary) 0%, var(--primary-strong) 100%);
    box-shadow:
      0 10px 24px rgba(73, 58, 170, 0.28),
      inset 0 1px 0 rgba(255, 255, 255, 0.22);
  }

  .rail-link.active .rail-icon {
    background: rgba(255, 255, 255, 0.14);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
    transform: scale(1.02);
  }

  .rail-link:active,
  .rail-link.active:active {
    transform: translateY(1px);
    transition-duration: 0s;
  }

  /* ── More overlay ── */
  .more-overlay {
    position: fixed;
    inset: 0;
    z-index: 101;
    border: none;
    background: rgba(4, 8, 24, 0.5);
    backdrop-filter: blur(6px);
    cursor: pointer;
  }

  /* ── More sheet ── */
  .more-sheet {
    position: fixed;
    left: 50%;
    width: min(26rem, calc(100vw - 1rem));
    margin: 0;
    transform: translateX(-50%);
    bottom: calc(var(--mobile-nav-height, 70px) + var(--mobile-nav-offset, 12px) + env(safe-area-inset-bottom) + var(--space-2));
    z-index: 102;
    border: 1px solid rgba(149, 164, 255, 0.14);
    border-radius: 1.4rem;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 36%),
      var(--surface-strong);
    backdrop-filter: blur(24px) saturate(145%);
    box-shadow:
      0 20px 40px rgba(2, 6, 24, 0.26),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    padding: 0.7rem 0.7rem 0.8rem;
    display: grid;
    gap: 0.8rem;
  }

  .sheet-handle {
    width: 2.35rem;
    height: 0.24rem;
    border-radius: var(--radius-full);
    background: rgba(149, 164, 255, 0.24);
    margin: 0.1rem auto 0;
  }

  .sheet-header {
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted-text);
    padding: 0 0.5rem;
  }

  .sheet-links {
    display: grid;
    gap: 0.35rem;
  }

  .sheet-link {
    width: 100%;
    font: inherit;
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 3.15rem;
    border-radius: 1rem;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-color);
    padding: 0.85rem 0.95rem;
    cursor: pointer;
    text-align: left;
    -webkit-tap-highlight-color: transparent;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease,
      transform 0.15s ease;
  }

  .sheet-link:hover {
    background: rgba(154, 139, 255, 0.07);
    border-color: rgba(149, 164, 255, 0.12);
  }

  .sheet-link :global(svg) {
    color: var(--primary);
  }

  .sheet-link:active {
    transform: translateY(1px);
    transition-duration: 0s;
  }

  .sheet-link.active {
    color: var(--text-color);
    border-color: rgba(154, 139, 255, 0.16);
    background:
      linear-gradient(135deg, rgba(154, 139, 255, 0.14), rgba(154, 139, 255, 0.04)),
      var(--surface-soft);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }

  .sheet-link.active :global(svg) {
    color: var(--primary-strong);
  }

  @media (max-width: 420px) {
    .bottom-rail,
    .more-sheet {
      width: calc(100vw - 0.75rem);
    }
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
