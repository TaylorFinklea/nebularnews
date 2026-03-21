<script lang="ts">
  import {
    IconArticle,
    IconBookmark,
    IconCompass,
    IconSun
  } from '$lib/icons';
  import { APP_NAV_ITEMS, isAppNavItemActive, type AppNavItemIcon } from '$lib/navigation/app-nav';

  export let currentPath = '/';

  const iconByName: Record<AppNavItemIcon, typeof IconSun> = {
    sun: IconSun,
    article: IconArticle,
    compass: IconCompass,
    bookmark: IconBookmark,
    settings: IconSun // not used in bottom nav
  };

  const primaryItems = APP_NAV_ITEMS.filter((item) => item.mobilePrimary);
</script>

<nav class="bottom-rail" aria-label="Bottom navigation" style={`--mobile-nav-columns: ${primaryItems.length};`}>
  {#each primaryItems as item}
    {@const Icon = iconByName[item.icon]}
    {@const active = isAppNavItemActive(item, currentPath)}
    <a
      href={item.href}
      class="rail-link"
      class:active
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      title={item.label}
    >
      <span class="rail-icon"><Icon size={20} stroke={1.9} /></span>
      <span class="sr-only">{item.label}</span>
    </a>
  {/each}
</nav>

<style>
  /* ── Bottom rail ── */
  .bottom-rail {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 100;
    display: grid;
    grid-template-columns: repeat(var(--mobile-nav-columns), minmax(0, 1fr));
    padding: var(--space-1) var(--space-2) calc(var(--space-1) + env(safe-area-inset-bottom));
    border-top: 1px solid var(--surface-border);
    background: var(--surface-strong);
    backdrop-filter: blur(var(--blur-lg));
    -webkit-backdrop-filter: blur(var(--blur-lg));
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

  /* Active top accent line */
  .rail-link::before {
    content: '';
    position: absolute;
    top: 0;
    left: 25%;
    right: 25%;
    height: 3px;
    border-radius: 0 0 3px 3px;
    background: var(--primary);
    opacity: 0;
    transform: scaleX(0.4);
    transition:
      opacity 0.15s ease,
      transform 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .rail-link.active {
    color: var(--text-color);
  }

  .rail-link.active::before {
    opacity: 1;
    transform: scaleX(1);
    box-shadow: 0 2px 8px rgba(124, 106, 239, 0.3);
  }

  .rail-link.active .rail-icon {
    color: var(--primary);
  }

  /* Touch press feedback */
  .rail-link:active {
    background: var(--primary-soft);
    transition-duration: 0s;
  }

  /* ── Hide on desktop ── */
  @media (min-width: 801px) {
    .bottom-rail {
      display: none;
    }
  }
</style>
