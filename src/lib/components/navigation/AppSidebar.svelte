<script lang="ts">
  import {
    IconArticle,
    IconArrowLeft,
    IconClockPlay,
    IconLayoutDashboard,
    IconMessage2,
    IconMoonStars,
    IconRss,
    IconSettings,
    IconSun,
    IconTag
  } from '$lib/icons';
  import { APP_NAV_ITEMS, isAppNavItemActive, type AppNavItem, type AppNavItemIcon } from '$lib/navigation/app-nav';

  export let currentPath = '/';
  export let collapsed = false;
  export let theme: 'dark' | 'light' = 'dark';
  export let onToggleTheme: () => void = () => {};
  export let onToggleCollapse: () => void = () => {};

  const iconByName: Record<AppNavItemIcon, typeof IconLayoutDashboard> = {
    layoutDashboard: IconLayoutDashboard,
    article: IconArticle,
    message: IconMessage2,
    settings: IconSettings,
    tag: IconTag,
    rss: IconRss,
    clockPlay: IconClockPlay
  };

  const primaryItems = APP_NAV_ITEMS.filter((item) => item.group === 'primary');
  const manageItems = APP_NAV_ITEMS.filter((item) => item.group === 'manage');
  const themeLabel = () => (theme === 'dark' ? 'Light mode' : 'Dark mode');
  const collapseLabel = () => (collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  const isActive = (item: AppNavItem) => isAppNavItemActive(item, currentPath);
</script>

<aside class="sidebar" class:collapsed aria-label="App sidebar">
  <div class="sidebar-inner">
    <a
      class="brand"
      href="/"
      aria-label="Nebular News"
      title={collapsed ? 'Nebular News' : undefined}
    >
      <span class="brand-mark">Nebular</span>
      <span class="brand-accent">News</span>
    </a>

    <nav class="nav-group" aria-label="Primary navigation">
      {#each primaryItems as item}
        {@const Icon = iconByName[item.icon]}
        {@const active = isActive(item)}
        <a
          href={item.href}
          class="nav-link"
          class:active
          aria-current={active ? 'page' : undefined}
          aria-label={collapsed ? item.label : undefined}
          title={collapsed ? item.label : undefined}
        >
          <span class="nav-icon"><Icon size={18} stroke={1.9} /></span>
          <span class="nav-label">{item.label}</span>
        </a>
      {/each}
    </nav>

    <div class="manage-block">
      <div class="block-label">Manage</div>
      <nav class="nav-group" aria-label="Management navigation">
        {#each manageItems as item}
          {@const Icon = iconByName[item.icon]}
          {@const active = isActive(item)}
          <a
            href={item.href}
            class="nav-link"
            class:active
            aria-current={active ? 'page' : undefined}
            aria-label={collapsed ? item.label : undefined}
            title={collapsed ? item.label : undefined}
          >
            <span class="nav-icon"><Icon size={18} stroke={1.9} /></span>
            <span class="nav-label">{item.label}</span>
          </a>
        {/each}
      </nav>
    </div>

    <div class="sidebar-footer">
      <button
        type="button"
        class="sidebar-action"
        on:click={onToggleTheme}
        aria-label={themeLabel()}
        title={themeLabel()}
      >
        <span class="nav-icon">
          {#if theme === 'dark'}
            <IconSun size={18} stroke={1.9} />
          {:else}
            <IconMoonStars size={18} stroke={1.9} />
          {/if}
        </span>
        <span class="nav-label">{themeLabel()}</span>
      </button>

      <button
        type="button"
        class="sidebar-action"
        on:click={onToggleCollapse}
        aria-label={collapseLabel()}
        title={collapseLabel()}
      >
        <span class="nav-icon collapse-icon" class:is-collapsed={collapsed}>
          <IconArrowLeft size={18} stroke={1.9} />
        </span>
        <span class="nav-label">{collapseLabel()}</span>
      </button>
    </div>
  </div>
</aside>

<style>
  .sidebar {
    position: sticky;
    top: 0;
    height: 100vh;
    border-right: 1px solid var(--surface-border);
    background: var(--surface);
    backdrop-filter: blur(12px);
    overflow: hidden;
  }

  .sidebar-inner {
    height: 100%;
    padding: var(--space-5) var(--space-3);
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    gap: var(--space-4);
  }

  .brand {
    font-family: 'Source Serif 4', serif;
    font-size: 1.35rem;
    letter-spacing: 0.02em;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.1rem var(--space-2);
    border-radius: var(--radius-sm);
  }

  .brand-mark {
    font-weight: 600;
  }

  .brand-accent {
    color: var(--primary);
  }

  .nav-group {
    display: grid;
    gap: var(--space-1);
  }

  .manage-block {
    display: grid;
    gap: var(--space-2);
  }

  .block-label {
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted-text);
    padding: 0 var(--space-2);
  }

  .nav-link,
  .sidebar-action {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    border-radius: var(--radius-md);
    padding: 0.55rem var(--space-3);
    color: var(--text-color);
    background: transparent;
    border: 1px solid transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }

  .nav-link:hover,
  .sidebar-action:hover {
    background: var(--primary-soft);
  }

  .nav-link.active {
    background: var(--primary-soft);
    border-color: var(--ghost-border);
    color: var(--primary);
    font-weight: 600;
  }

  .nav-icon {
    width: 1.35rem;
    height: 1.35rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .nav-label {
    white-space: nowrap;
  }

  .sidebar-footer {
    display: grid;
    gap: var(--space-1);
    padding-top: var(--space-3);
    border-top: 1px solid var(--surface-border);
  }

  .collapse-icon {
    transition: transform var(--transition-fast);
  }

  .collapse-icon.is-collapsed {
    transform: rotate(180deg);
  }

  .sidebar.collapsed .sidebar-inner {
    padding-left: var(--space-2);
    padding-right: var(--space-2);
  }

  .sidebar.collapsed .brand {
    justify-content: center;
    padding: 0.25rem 0;
  }

  .sidebar.collapsed .brand-mark,
  .sidebar.collapsed .brand-accent,
  .sidebar.collapsed .block-label,
  .sidebar.collapsed .nav-label {
    display: none;
  }

  .sidebar.collapsed .nav-link,
  .sidebar.collapsed .sidebar-action {
    justify-content: center;
    padding-left: var(--space-2);
    padding-right: var(--space-2);
  }

  @media (max-width: 800px) {
    .sidebar {
      display: none;
    }
  }
</style>
