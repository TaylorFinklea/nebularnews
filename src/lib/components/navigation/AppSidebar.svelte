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
    IconStars,
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
  const workspaceItems = APP_NAV_ITEMS.filter((item) => item.group === 'workspace');
  const themeLabel = () => (theme === 'dark' ? 'Light mode' : 'Dark mode');
  const collapseLabel = () => (collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  const isActive = (item: AppNavItem) => isAppNavItemActive(item, currentPath);
</script>

<aside class="sidebar" class:collapsed aria-label="App sidebar">
  <div class="sidebar-inner">
    <div class="sidebar-main">
      <a
        class="brand"
        href="/"
        aria-label="Nebular News"
        title={collapsed ? 'Nebular News' : undefined}
      >
        <span class="brand-icon">
          <IconStars size={22} stroke={1.8} />
        </span>
        <span class="brand-text">
          <span class="brand-mark">Nebular</span>
          <span class="brand-accent">News</span>
        </span>
      </a>

      <div class="nav-panel nav-panel-primary">
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
      </div>

      <div class="nav-panel workspace-block">
        <div class="block-label">Workspace</div>
        <nav class="nav-group" aria-label="Workspace navigation">
          {#each workspaceItems as item}
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
    overflow: hidden;
  }

  .sidebar-inner {
    height: 100%;
    padding: var(--space-5) var(--space-3) var(--space-4);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    overflow-y: auto;
  }

  .sidebar-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.15rem var(--space-2);
    border-radius: var(--radius-sm);
  }

  .brand-icon {
    flex-shrink: 0;
    width: 1.7rem;
    height: 1.7rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--primary);
  }

  .brand-text {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    font-family: inherit;
    font-size: 1.32rem;
    letter-spacing: 0.01em;
    white-space: nowrap;
    opacity: 1;
    transition: opacity 0.2s ease 0.05s;
  }

  .brand-mark {
    font-weight: 700;
  }

  .brand-accent {
    color: var(--muted-text);
  }

  .nav-panel {
    display: grid;
    gap: var(--space-2);
  }

  .nav-group {
    display: grid;
    gap: var(--space-1);
  }

  .workspace-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .block-label {
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted-text);
    padding: 0 0.7rem;
    white-space: nowrap;
    opacity: 1;
    transition: opacity 0.12s ease;
  }

  .nav-link,
  .sidebar-action {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 2.75rem;
    border-radius: var(--radius-md);
    padding: 0.62rem var(--space-3);
    color: var(--text-color);
    background: transparent;
    border: 1px solid transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }

  .nav-link:hover,
  .sidebar-action:hover {
    background: var(--surface-soft);
  }

  .nav-link.active {
    background: transparent;
    border-color: transparent;
    border-left: 3px solid var(--primary);
    border-radius: 0;
    padding-left: calc(var(--space-3) - 3px);
    color: var(--text-color);
  }

  .nav-icon {
    width: 1.35rem;
    height: 1.35rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: inherit;
  }

  .nav-label {
    white-space: nowrap;
    font-size: 0.98rem;
    opacity: 1;
    transform: translateX(0);
    transition:
      opacity 0.15s ease,
      transform 0.15s ease;
  }

  .nav-link.active .nav-label {
    font-weight: 600;
  }

  .sidebar-footer {
    display: grid;
    gap: var(--space-1);
    margin-top: auto;
    padding-top: var(--space-3);
    border-top: 1px solid var(--surface-border);
  }

  .collapse-icon {
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
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

  .sidebar.collapsed .brand-text {
    opacity: 0;
    width: 0;
    overflow: hidden;
    transition: opacity 0.12s ease, width 0s linear 0.12s;
  }

  .sidebar.collapsed .block-label {
    opacity: 0;
    height: 0;
    overflow: hidden;
    padding: 0;
    transition: opacity 0.1s ease, height 0s linear 0.1s;
  }

  .sidebar.collapsed .nav-label {
    opacity: 0;
    transform: translateX(-8px);
    width: 0;
    overflow: hidden;
    pointer-events: none;
    transition:
      opacity 0.12s ease,
      transform 0.12s ease,
      width 0s linear 0.12s;
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
