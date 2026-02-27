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
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&display=swap"
  />
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
    --bg-gradient-start: #050915;
    --bg-gradient-mid: #0b1638;
    --bg-gradient-end: #1a1640;
    --nebula-a: rgba(120, 95, 255, 0.28);
    --nebula-b: rgba(53, 147, 255, 0.22);
    --text-color: #ecf0ff;
    --muted-text: rgba(225, 232, 255, 0.72);
    --surface: rgba(14, 22, 52, 0.78);
    --surface-strong: rgba(10, 16, 40, 0.88);
    --surface-soft: rgba(20, 28, 60, 0.7);
    --surface-border: rgba(149, 164, 255, 0.10);
    --shadow-color: rgba(2, 6, 24, 0.45);
    --primary: #9a8bff;
    --primary-strong: #8573ff;
    --primary-soft: rgba(154, 139, 255, 0.2);
    --primary-contrast: #f6f8ff;
    --button-bg: var(--primary);
    --button-text: #f6f8ff;
    --ghost-color: #b5a7ff;
    --ghost-border: rgba(154, 139, 255, 0.42);
    --input-bg: rgba(8, 13, 34, 0.7);
    --input-border: rgba(149, 164, 255, 0.26);
    --danger: #ff8ca1;
  }

  :global(:root[data-theme='light']) {
    --bg-gradient-start: #f6f8ff;
    --bg-gradient-mid: #e9ecff;
    --bg-gradient-end: #dde4ff;
    --nebula-a: rgba(129, 107, 255, 0.2);
    --nebula-b: rgba(80, 179, 255, 0.18);
    --text-color: #171e41;
    --muted-text: rgba(22, 30, 65, 0.66);
    --surface: rgba(255, 255, 255, 0.92);
    --surface-strong: rgba(255, 255, 255, 0.96);
    --surface-soft: rgba(244, 247, 255, 0.90);
    --surface-border: rgba(98, 112, 191, 0.10);
    --shadow-color: rgba(35, 49, 122, 0.16);
    --primary: #6351ef;
    --primary-strong: #5442d8;
    --primary-soft: rgba(99, 81, 239, 0.14);
    --primary-contrast: #f8f9ff;
    --button-bg: var(--primary);
    --button-text: #f8f9ff;
    --ghost-color: #5543da;
    --ghost-border: rgba(86, 67, 218, 0.35);
    --input-bg: rgba(255, 255, 255, 0.84);
    --input-border: rgba(93, 107, 187, 0.34);
    --danger: #c12f5d;
  }

  :global(body) {
    margin: 0;
    font-family: 'Space Grotesk', system-ui, sans-serif;
    background:
      radial-gradient(1200px 620px at 8% -10%, var(--nebula-a), transparent 62%),
      radial-gradient(950px 560px at 95% 0%, var(--nebula-b), transparent 60%),
      linear-gradient(160deg, var(--bg-gradient-start), var(--bg-gradient-mid) 45%, var(--bg-gradient-end));
    color: var(--text-color);
    min-height: 100vh;
  }

  :global(h1),
  :global(h2),
  :global(h3) {
    font-family: 'Space Grotesk', system-ui, sans-serif;
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
