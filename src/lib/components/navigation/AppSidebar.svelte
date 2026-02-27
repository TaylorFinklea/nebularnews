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
    position: relative;
    position: sticky;
    top: 0;
    height: 100vh;
    border-right: 1px solid var(--surface-border);
    background:
      radial-gradient(280px 220px at 0% 0%, rgba(154, 139, 255, 0.14), transparent 72%),
      linear-gradient(180deg, var(--surface-strong) 0%, var(--surface) 100%);
    backdrop-filter: blur(12px);
    overflow: hidden;
    box-shadow:
      inset -1px 0 0 rgba(149, 164, 255, 0.08),
      24px 0 48px var(--shadow-color);
  }

  .sidebar::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent 22%),
      radial-gradient(320px 360px at 100% 100%, rgba(53, 147, 255, 0.08), transparent 65%);
    opacity: 0.9;
  }

  .sidebar-inner {
    position: relative;
    z-index: 1;
    height: 100%;
    padding: var(--space-5) var(--space-4) var(--space-4);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    overflow-y: auto;
  }

  .sidebar-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  /* ── Brand ── */
  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0.95rem 1rem;
    border-radius: 1.15rem;
    border: 1px solid rgba(149, 164, 255, 0.12);
    background:
      linear-gradient(135deg, rgba(154, 139, 255, 0.16), transparent 72%),
      var(--surface-soft);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.05),
      0 14px 34px var(--shadow-color);
    overflow: hidden;
  }

  .brand-icon {
    flex-shrink: 0;
    width: 2.5rem;
    height: 2.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--primary);
    border-radius: 0.9rem;
    background: rgba(154, 139, 255, 0.12);
    box-shadow: inset 0 0 0 1px rgba(154, 139, 255, 0.2);
  }

  .brand-text {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    font-family: 'Space Grotesk', system-ui, sans-serif;
    font-size: 1.1rem;
    letter-spacing: -0.02em;
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

  .nav-panel {
    padding: 0.5rem;
    border-radius: 1.25rem;
    border: 1px solid rgba(149, 164, 255, 0.12);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 32%),
      var(--surface-soft);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  .nav-panel-primary {
    padding-top: 0.55rem;
    padding-bottom: 0.55rem;
  }

  /* ── Nav group ── */
  .nav-group {
    display: grid;
    gap: 0.35rem;
  }

  .workspace-block {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .block-label {
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted-text);
    padding: 0.1rem 0.45rem 0;
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
    min-height: 3rem;
    border-radius: 1rem;
    padding: 0.72rem 0.85rem;
    color: var(--muted-text);
    background: transparent;
    border: 1px solid transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }

  .nav-link:hover,
  .sidebar-action:hover {
    background: rgba(154, 139, 255, 0.09);
    border-color: rgba(149, 164, 255, 0.12);
    color: var(--text-color);
  }

  /* Active accent bar */
  .nav-link::before {
    content: '';
    position: absolute;
    left: 0.7rem;
    top: 50%;
    width: 0.42rem;
    height: 0.42rem;
    margin-top: -0.21rem;
    border-radius: 999px;
    background: var(--primary);
    opacity: 0;
    box-shadow: 0 0 0 0.22rem rgba(154, 139, 255, 0.12);
    transform: scale(0.6);
    transition:
      opacity 0.15s ease,
      transform 0.18s cubic-bezier(0.4, 0, 0.2, 1),
      box-shadow 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .nav-link.active::before {
    opacity: 1;
    transform: scale(1);
    box-shadow: 0 0 0 0.32rem rgba(154, 139, 255, 0.14);
  }

  .nav-link.active {
    color: var(--primary);
    background:
      linear-gradient(135deg, rgba(154, 139, 255, 0.18), rgba(154, 139, 255, 0.06)),
      var(--surface-soft);
    border-color: rgba(154, 139, 255, 0.18);
    font-weight: 500;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.05),
      0 10px 22px var(--shadow-color);
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
    font-size: 0.98rem;
    letter-spacing: -0.01em;
    opacity: 1;
    transform: translateX(0);
    transition:
      opacity 0.15s ease,
      transform 0.15s ease;
  }

  /* ── Footer ── */
  .sidebar-footer {
    display: grid;
    gap: var(--space-1);
    margin-top: auto;
    padding: 0.5rem;
    border-radius: 1.25rem;
    border: 1px solid rgba(149, 164, 255, 0.12);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 28%),
      var(--surface-soft);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
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

  .sidebar.collapsed .sidebar-main {
    gap: var(--space-3);
  }

  .sidebar.collapsed .brand {
    justify-content: center;
    padding: 0.85rem 0;
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
    padding-left: 0.65rem;
    padding-right: 0.65rem;
  }

  .sidebar.collapsed .nav-link::before {
    display: none;
  }

  .sidebar.collapsed .nav-panel,
  .sidebar.collapsed .sidebar-footer {
    padding-left: 0.4rem;
    padding-right: 0.4rem;
  }

  /* ── Hide on mobile ── */
  @media (max-width: 800px) {
    .sidebar {
      display: none;
    }
  }
</style>
