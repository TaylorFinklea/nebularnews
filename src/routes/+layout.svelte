<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { fade } from 'svelte/transition';
  import '$lib/styles/tokens.css';
  import AppSidebar from '$lib/components/navigation/AppSidebar.svelte';
  import MobileBottomNav from '$lib/components/navigation/MobileBottomNav.svelte';
  import Toast from '$lib/components/Toast.svelte';

  const THEME_KEY = 'nebular-theme';
  const SIDEBAR_COLLAPSED_KEY = 'nebular-sidebar-collapsed';

  let theme = 'dark';
  let sidebarCollapsed = false;

  $: currentPath = $page.url.pathname;
  $: isLoginRoute = currentPath === '/login';

  const resolveInitialTheme = () => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'dark';
    }
  };

  const setTheme = (nextTheme, persist = true) => {
    theme = nextTheme;
    document.documentElement.dataset.theme = nextTheme;
    if (!persist) return;
    try {
      localStorage.setItem(THEME_KEY, nextTheme);
    } catch {
      // Ignore storage errors in private/incognito sessions.
    }
  };

  const setSidebarCollapsed = (nextValue, persist = true) => {
    sidebarCollapsed = Boolean(nextValue);
    if (!persist) return;
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      // Ignore storage errors in private/incognito sessions.
    }
  };

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');
  const toggleSidebarCollapsed = () => setSidebarCollapsed(!sidebarCollapsed);

  onMount(() => {
    setTheme(resolveInitialTheme(), false);

    try {
      const storedSidebarValue = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (storedSidebarValue === '1') setSidebarCollapsed(true, false);
      if (storedSidebarValue === '0') setSidebarCollapsed(false, false);
    } catch {
      // Ignore storage errors in private/incognito sessions.
    }

    try {
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      document.cookie = `nebular_tz_offset_min=${tzOffsetMinutes}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      // Ignore cookie errors.
    }
  });
</script>

<svelte:head>
  <title>Nebular News</title>
  <script>
    (() => {
      try {
        const key = 'nebular-theme';
        const stored = localStorage.getItem(key);
        const resolved =
          stored === 'light' || stored === 'dark'
            ? stored
            : window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light';
        document.documentElement.dataset.theme = resolved;
      } catch {
        document.documentElement.dataset.theme = 'dark';
      }
    })();
  </script>
</svelte:head>

<div class="app-shell" class:with-chrome={!isLoginRoute} class:sidebar-collapsed={sidebarCollapsed}>
  {#if !isLoginRoute}
    <AppSidebar
      {currentPath}
      collapsed={sidebarCollapsed}
      {theme}
      onToggleTheme={toggleTheme}
      onToggleCollapse={toggleSidebarCollapsed}
    />
  {/if}

  <div class="main-column" class:with-mobile-nav={!isLoginRoute}>
    <main class="content">
      {#key currentPath}
        <div in:fade={{ duration: 120, delay: 40 }}>
          <slot />
        </div>
      {/key}
    </main>
  </div>

  {#if !isLoginRoute}
    <MobileBottomNav {currentPath} {theme} onToggleTheme={toggleTheme} />
  {/if}
</div>

<Toast />

<style>
  :global(:root) {
    --mobile-nav-height: 70px;
    --mobile-nav-offset: 12px;
    --bg-flat: #000000;
    --text-color: #f5f5f7;
    --muted-text: rgba(245, 245, 247, 0.55);
    --surface: #1c1c1e;
    --surface-strong: #1c1c1e;
    --surface-soft: #2c2c2e;
    --surface-border: rgba(255, 255, 255, 0.08);
    --shadow-color: rgba(0, 0, 0, 0.3);
    --primary: #7c5cff;
    --primary-strong: #6B4EFF;
    --primary-soft: rgba(124, 92, 255, 0.12);
    --primary-contrast: #ffffff;
    --button-bg: var(--primary);
    --button-text: #ffffff;
    --ghost-color: var(--text-color);
    --ghost-border: rgba(255, 255, 255, 0.16);
    --input-bg: #1c1c1e;
    --input-border: rgba(255, 255, 255, 0.12);
    --danger: #ff453a;
  }

  :global(:root[data-theme='light']) {
    --bg-flat: #ffffff;
    --text-color: #1d1d1f;
    --muted-text: rgba(29, 29, 31, 0.50);
    --surface: #ffffff;
    --surface-strong: #ffffff;
    --surface-soft: #f5f5f7;
    --surface-border: rgba(0, 0, 0, 0.08);
    --shadow-color: rgba(0, 0, 0, 0.08);
    --primary: #6340e0;
    --primary-strong: #5633cc;
    --primary-soft: rgba(99, 64, 224, 0.08);
    --primary-contrast: #ffffff;
    --button-bg: var(--primary);
    --button-text: #ffffff;
    --ghost-color: #1d1d1f;
    --ghost-border: rgba(0, 0, 0, 0.12);
    --input-bg: #ffffff;
    --input-border: rgba(0, 0, 0, 0.12);
    --danger: #d4232a;
  }

  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif;
    background: var(--bg-flat);
    color: var(--text-color);
    min-height: 100vh;
  }

  :global(h1),
  :global(h2),
  :global(h3) {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif;
  }

  :global(a) {
    color: inherit;
    text-decoration: none;
  }

  :global(button) {
    font-family: inherit;
  }

  :global(input),
  :global(select),
  :global(textarea) {
    font-family: inherit;
    color: var(--text-color);
    background: var(--input-bg);
    border: 1px solid var(--input-border);
  }

  :global(input::placeholder),
  :global(textarea::placeholder) {
    color: var(--muted-text);
  }

  :global(.muted) {
    color: var(--muted-text);
  }

  :global(.sr-only) {
    position: absolute !important;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .app-shell {
    min-height: 100vh;
  }

  .app-shell.with-chrome {
    display: grid;
    grid-template-columns: 248px minmax(0, 1fr);
    transition: grid-template-columns 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .app-shell.with-chrome.sidebar-collapsed {
    grid-template-columns: 76px minmax(0, 1fr);
  }

  .main-column {
    min-width: 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .content {
    padding: var(--content-padding);
    flex: 1;
    max-width: var(--content-max-width);
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }

  @media (max-width: 800px) {
    .app-shell.with-chrome {
      display: block;
    }

    .content {
      padding: var(--space-6);
    }

    .main-column.with-mobile-nav .content {
      padding-bottom: calc(var(--mobile-nav-height) + var(--mobile-nav-offset) + env(safe-area-inset-bottom) + var(--space-6));
    }
  }
</style>
