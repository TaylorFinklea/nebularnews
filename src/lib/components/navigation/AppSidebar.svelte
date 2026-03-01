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

      <div class="nav-panel">
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

      <div class="workspace-block">
        <div class="block-label">Workspace</div>
        <div class="nav-panel">
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
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    box-sizing: border-box;
  }

  .sidebar-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .nav-panel {
    background: color-mix(in srgb, var(--surface-soft) 65%, transparent);
    border: 1px solid color-mix(in srgb, var(--surface-border) 80%, transparent);
    border-radius: var(--radius-lg);
    padding: var(--space-2);
  }

  /* ── Brand ── */
  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .brand-icon {
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--primary);
  }

  .brand-text {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    font-family: 'Space Grotesk', system-ui, sans-serif;
    font-size: 1.35rem;
    letter-spacing: 0.02em;
    white-space: nowrap;
    opacity: 1;
    transition: opacity 0.2s ease 0.05s;
  }

  .brand-mark {
    font-weight: 600;
  }

  .brand-accent {
    color: var(--primary);
  }

  /* ── Nav group ── */
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
    padding: 0 var(--space-2);
    white-space: nowrap;
    opacity: 1;
    transition: opacity 0.12s ease;
  }

  /* ── Nav links ── */
  .nav-link,
  .sidebar-action {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    border-radius: var(--radius-md);
    padding: 0.55rem var(--space-3);
    color: var(--muted-text);
    background: transparent;
    border: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }

  .nav-link:hover,
  .sidebar-action:hover {
    background: var(--primary-soft);
    color: var(--text-color);
  }

  /* Active accent bar */
  .nav-link::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--primary);
    opacity: 0;
    transform: scaleY(0.4);
    transition:
      opacity 0.15s ease,
      transform 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .nav-link.active::before {
    opacity: 1;
    transform: scaleY(1);
  }

  .nav-link.active {
    color: var(--primary);
    background: var(--primary-soft);
    font-weight: 500;
  }

  /* ── Icon / Label ── */
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
    opacity: 1;
    transform: translateX(0);
    transition:
      opacity 0.15s ease,
      transform 0.15s ease;
  }

  /* ── Footer ── */
  .sidebar-footer {
    margin-top: auto;
    display: grid;
    gap: var(--space-1);
    padding-top: var(--space-3);
    border-top: 1px solid var(--surface-border);
  }

  .collapse-icon {
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .collapse-icon.is-collapsed {
    transform: rotate(180deg);
  }

  /* ── Collapsed state ── */
  .sidebar.collapsed .sidebar-inner {
    padding-left: var(--space-2);
    padding-right: var(--space-2);
  }

  .sidebar.collapsed .brand {
    justify-content: center;
    padding: var(--space-1) 0;
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

  /* ── Hide on mobile ── */
  @media (max-width: 800px) {
    .sidebar {
      display: none;
    }
  }
</style>
