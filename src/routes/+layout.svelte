<script>
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import '$lib/styles/tokens.css';
  import AppSidebar from '$lib/components/navigation/AppSidebar.svelte';
  import MobileBottomNav from '$lib/components/navigation/MobileBottomNav.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import { IconMoonStars, IconSettings, IconSun } from '$lib/icons';

  const THEME_KEY = 'nebular-theme';
  const SIDEBAR_COLLAPSED_KEY = 'nebular-sidebar-collapsed';
  const DARK_THEME_COLOR = '#030711';
  const LIGHT_THEME_COLOR = '#f8f7fc';

  let theme = 'dark';
  let sidebarCollapsed = false;
  let currentPath = page.url.pathname;

  $: isLoginRoute = currentPath === '/login';

  afterNavigate((navigation) => {
    currentPath = navigation.to?.url.pathname ?? page.url.pathname;
  });

  const resolveInitialTheme = () => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'dark';
    }
  };

  const getThemeColor = (nextTheme) => (nextTheme === 'light' ? LIGHT_THEME_COLOR : DARK_THEME_COLOR);

  const upsertMeta = (name, content) => {
    if (typeof document === 'undefined') return;
    let element = document.head.querySelector(`meta[name="${name}"]`);
    if (!element) {
      element = document.createElement('meta');
      element.setAttribute('name', name);
      document.head.appendChild(element);
    }
    element.setAttribute('content', content);
  };

  const syncThemeChrome = (nextTheme) => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    upsertMeta('theme-color', getThemeColor(nextTheme));
    upsertMeta('color-scheme', nextTheme === 'dark' ? 'dark light' : 'light dark');
    upsertMeta(
      'apple-mobile-web-app-status-bar-style',
      nextTheme === 'dark' ? 'black-translucent' : 'default'
    );
  };

  const setTheme = (nextTheme, persist = true) => {
    theme = nextTheme;
    syncThemeChrome(nextTheme);
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
  <meta name="apple-mobile-web-app-title" content="Nebular News" />
  <link rel="apple-touch-icon" href="/nebularnews-logo.png" />
  <link rel="icon" href="/nebularnews-logo.png" type="image/png" />
  <link rel="icon" href="/nebularnews-logo-tight.svg" type="image/svg+xml" />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
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
        const themeColor = resolved === 'light' ? '#f8f7fc' : '#030711';
        document.documentElement.dataset.theme = resolved;
        document.documentElement.style.colorScheme = resolved;
        const themeMeta =
          document.head.querySelector('meta[name="theme-color"]') ??
          document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }));
        themeMeta.setAttribute('content', themeColor);
        const colorSchemeMeta =
          document.head.querySelector('meta[name="color-scheme"]') ??
          document.head.appendChild(
            Object.assign(document.createElement('meta'), { name: 'color-scheme' })
          );
        colorSchemeMeta.setAttribute('content', resolved === 'dark' ? 'dark light' : 'light dark');
        const statusBarMeta =
          document.head.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]') ??
          document.head.appendChild(
            Object.assign(document.createElement('meta'), {
              name: 'apple-mobile-web-app-status-bar-style'
            })
          );
        statusBarMeta.setAttribute('content', resolved === 'dark' ? 'black-translucent' : 'default');
      } catch {
        document.documentElement.dataset.theme = 'dark';
        document.documentElement.style.colorScheme = 'dark';
        const themeMeta =
          document.head.querySelector('meta[name="theme-color"]') ??
          document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }));
        themeMeta.setAttribute('content', '#030711');
        const colorSchemeMeta =
          document.head.querySelector('meta[name="color-scheme"]') ??
          document.head.appendChild(
            Object.assign(document.createElement('meta'), { name: 'color-scheme' })
          );
        colorSchemeMeta.setAttribute('content', 'dark light');
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
    {#if !isLoginRoute}
      <header class="mobile-header">
        <button
          type="button"
          class="mobile-theme-btn"
          on:click={toggleTheme}
          aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {#if theme === 'dark'}
            <IconSun size={20} stroke={1.9} />
          {:else}
            <IconMoonStars size={20} stroke={1.9} />
          {/if}
        </button>
        <a href="/settings" class="mobile-settings-btn" aria-label="Settings">
          <IconSettings size={20} stroke={1.9} />
        </a>
      </header>
    {/if}
    <main class="content">
      {#key currentPath}
        <div in:fade={{ duration: 150, delay: 60 }}>
          <slot />
        </div>
      {/key}
    </main>
  </div>

  {#if !isLoginRoute}
    <MobileBottomNav {currentPath} />
  {/if}
</div>

<Toast />

<style>
  :global(:root) {
    color-scheme: dark;
    --mobile-nav-height: 64px;
    --mobile-nav-offset: 12px;
    --bg-gradient-start: #030711;
    --bg-gradient-mid: #080e24;
    --bg-gradient-end: #110d2e;
    --nebula-a: rgba(99, 72, 255, 0.22);
    --nebula-b: rgba(40, 100, 200, 0.16);
    --nebula-c: rgba(220, 120, 80, 0.10);
    --nebula-d: rgba(200, 70, 140, 0.08);
    --accent: #3dc8c0;
    --accent-strong: #2bb0a8;
    --accent-soft: rgba(61, 200, 192, 0.12);
    --accent-contrast: #f0fffd;
    --surface-border-hover: rgba(124, 106, 239, 0.18);
    --text-color: #e8ecf4;
    --muted-text: rgba(200, 210, 235, 0.58);
    --surface: rgba(10, 14, 36, 0.72);
    --surface-strong: rgba(8, 11, 28, 0.85);
    --surface-soft: rgba(16, 20, 48, 0.55);
    --surface-border: rgba(120, 130, 200, 0.07);
    --shadow-color: rgba(0, 2, 12, 0.5);
    --primary: #7c6aef;
    --primary-strong: #6b57e8;
    --primary-soft: rgba(124, 106, 239, 0.12);
    --primary-contrast: #f4f5ff;
    --button-bg: var(--primary);
    --button-text: #f4f5ff;
    --ghost-color: #a598f0;
    --ghost-border: rgba(124, 106, 239, 0.28);
    --input-bg: rgba(6, 8, 22, 0.6);
    --input-border: rgba(120, 130, 200, 0.15);
    --danger: #f47a94;
  }

  :global(:root[data-theme='light']) {
    color-scheme: light;
    --bg-gradient-start: #f8f7fc;
    --bg-gradient-mid: #eee9f8;
    --bg-gradient-end: #e4ddf5;
    --nebula-a: rgba(110, 80, 220, 0.10);
    --nebula-b: rgba(60, 140, 220, 0.08);
    --nebula-c: rgba(200, 110, 60, 0.06);
    --nebula-d: rgba(180, 70, 120, 0.05);
    --accent: #1a8f88;
    --accent-strong: #147a74;
    --accent-soft: rgba(26, 143, 136, 0.08);
    --accent-contrast: #f0fffd;
    --surface-border-hover: rgba(90, 62, 214, 0.14);
    --text-color: #1a1430;
    --muted-text: rgba(26, 20, 48, 0.52);
    --surface: rgba(255, 255, 255, 0.88);
    --surface-strong: rgba(255, 255, 255, 0.94);
    --surface-soft: rgba(246, 242, 255, 0.85);
    --surface-border: rgba(80, 60, 150, 0.06);
    --shadow-color: rgba(40, 20, 100, 0.10);
    --primary: #5a3ed6;
    --primary-strong: #4c30c4;
    --primary-soft: rgba(90, 62, 214, 0.08);
    --primary-contrast: #faf9ff;
    --button-bg: var(--primary);
    --button-text: #faf9ff;
    --ghost-color: #4a36b8;
    --ghost-border: rgba(74, 54, 184, 0.20);
    --input-bg: rgba(255, 255, 255, 0.78);
    --input-border: rgba(80, 60, 150, 0.16);
    --danger: #b82850;
  }

  :global(body) {
    margin: 0;
    font-family: var(--font-body);
    color: var(--text-color);
    min-height: 100vh;
    background-color: var(--bg-gradient-start);
    background-image:
      radial-gradient(1px 1px at 20% 30%, rgba(200, 210, 255, 0.19), transparent),
      radial-gradient(1px 1px at 80% 10%, rgba(200, 210, 255, 0.16), transparent),
      radial-gradient(1.5px 1.5px at 65% 50%, rgba(180, 190, 255, 0.22), transparent),
      radial-gradient(1px 1px at 10% 85%, rgba(200, 210, 255, 0.14), transparent),
      radial-gradient(1px 1px at 45% 65%, rgba(255, 210, 180, 0.12), transparent),
      radial-gradient(900px 500px at 5% -8%, var(--nebula-a), transparent 55%),
      radial-gradient(700px 400px at 92% 5%, var(--nebula-b), transparent 50%),
      radial-gradient(650px 400px at 35% 70%, var(--nebula-c), transparent 50%),
      radial-gradient(500px 350px at 75% 85%, var(--nebula-d), transparent 50%),
      radial-gradient(600px 350px at 50% 100%, rgba(80, 50, 180, 0.08), transparent 50%),
      linear-gradient(170deg, var(--bg-gradient-start), var(--bg-gradient-mid) 40%, var(--bg-gradient-end));
    background-attachment: fixed;
  }

  :global(html) {
    background-color: var(--bg-gradient-start);
  }

  :global(h1),
  :global(h2) {
    font-family: var(--font-body);
    font-weight: 700;
    letter-spacing: var(--tracking-tight);
    line-height: var(--leading-tight);
  }

  :global(h3) {
    font-family: var(--font-body);
    font-weight: 600;
  }

  :global(a) {
    color: inherit;
    text-decoration: none;
  }

  :global(button) {
    font-family: var(--font-body);
  }

  :global(input),
  :global(select),
  :global(textarea) {
    font-family: var(--font-body);
    color: var(--text-color);
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: var(--radius-md);
    padding: 0.55rem 0.75rem;
    font-size: var(--text-sm);
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  :global(input:focus),
  :global(select:focus),
  :global(textarea:focus) {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft);
    outline: none;
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

  .mobile-header {
    display: none;
  }

  @media (max-width: 800px) {
    .app-shell.with-chrome {
      display: block;
    }

    .mobile-header {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      padding: calc(env(safe-area-inset-top) + var(--space-3)) var(--space-4) var(--space-2);
    }

    .mobile-settings-btn,
    .mobile-theme-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 2.2rem;
      height: 2.2rem;
      border-radius: var(--radius-md);
      color: var(--muted-text);
      background: transparent;
      border: none;
      cursor: pointer;
      font: inherit;
      transition: background 0.15s ease, color 0.15s ease;
    }

    .mobile-settings-btn:hover,
    .mobile-theme-btn:hover {
      background: var(--primary-soft);
      color: var(--text-color);
    }

    .content {
      padding:
        var(--space-3)
        var(--space-6)
        var(--space-6);
    }

    .main-column.with-mobile-nav .content {
      padding-bottom: calc(var(--mobile-nav-height) + env(safe-area-inset-bottom) + var(--mobile-nav-offset, 0px) + var(--space-6));
    }
  }
</style>
