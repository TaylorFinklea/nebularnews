<script>
import { invalidateAll } from '$app/navigation';
import { page } from '$app/stores';
import { onMount } from 'svelte';
import { get } from 'svelte/store';
import {
  IconArticle,
  IconLayoutDashboard,
  IconMessage2,
  IconMoonStars,
  IconSettings,
  IconSun
} from '$lib/icons';

  const THEME_KEY = 'nebular-theme';
  const DASHBOARD_REFRESH_INTERVAL_MS = 2000;
  const JOBS_REFRESH_INTERVAL_MS = 1000;
  const DEFAULT_REFRESH_INTERVAL_MS = 5000;
  const LIVE_REFRESH_TIMEOUT_MS = 4000;
  let theme = 'dark';
  let settingsMenu;
  let liveRefreshTimer;

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

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');
  const closeSettingsMenu = () => settingsMenu?.removeAttribute('open');

  const getLiveRefreshInterval = (pathname) => {
    if (pathname === '/') return DASHBOARD_REFRESH_INTERVAL_MS;
    if (pathname.startsWith('/jobs')) return JOBS_REFRESH_INTERVAL_MS;
    return DEFAULT_REFRESH_INTERVAL_MS;
  };

  const shouldLiveRefresh = (pathname) => {
    if (document.hidden) return false;
    if (pathname.startsWith('/login')) return false;
    if (pathname.startsWith('/settings')) return false;
    return pathname === '/' || pathname.startsWith('/jobs');
  };

  const scheduleLiveRefresh = () => {
    const pathname = get(page).url.pathname;
    const interval = getLiveRefreshInterval(pathname);
    if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
    liveRefreshTimer = setTimeout(() => {
      void runLiveRefreshCycle();
    }, interval);
  };

  const runLiveRefreshCycle = async () => {
    const pathname = get(page).url.pathname;
    try {
      if (shouldLiveRefresh(pathname)) {
        await Promise.race([
          invalidateAll(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('live refresh timeout')), LIVE_REFRESH_TIMEOUT_MS))
        ]);
      }
    } catch {
      // Ignore transient refresh failures; next cycle will retry.
    } finally {
      scheduleLiveRefresh();
    }
  };

  onMount(() => {
    setTheme(resolveInitialTheme(), false);
    try {
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      document.cookie = `nebular_tz_offset_min=${tzOffsetMinutes}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      // Ignore cookie errors.
    }

    const unsubscribePage = page.subscribe(() => {
      scheduleLiveRefresh();
    });
    scheduleLiveRefresh();

    return () => {
      if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
      unsubscribePage();
    };
  });
</script>

<svelte:head>
  <title>Nebular News</title>
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&family=Source+Serif+4:wght@400;600&display=swap"
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

<div class="app-shell">
  <header class="top-bar">
    <div class="brand">
      <span class="brand-mark">Nebular</span>
      <span class="brand-accent">News</span>
    </div>
    <div class="top-actions">
      <nav class="nav-links">
        <a href="/" class="nav-link">
          <IconLayoutDashboard size={16} stroke={1.9} />
          <span>Dashboard</span>
        </a>
        <a href="/articles" class="nav-link">
          <IconArticle size={16} stroke={1.9} />
          <span>Articles</span>
        </a>
        <a href="/chat" class="nav-link">
          <IconMessage2 size={16} stroke={1.9} />
          <span>Chat</span>
        </a>
        <details class="settings-menu" bind:this={settingsMenu}>
          <summary>
            <IconSettings size={16} stroke={1.9} />
            <span>Settings</span>
          </summary>
          <div class="submenu">
            <a href="/settings" on:click={closeSettingsMenu}>General</a>
            <a href="/tags" on:click={closeSettingsMenu}>Tags</a>
            <a href="/feeds" on:click={closeSettingsMenu}>Feeds</a>
            <a href="/jobs" on:click={closeSettingsMenu}>Jobs</a>
          </div>
        </details>
      </nav>
      <button class="theme-toggle" on:click={toggleTheme} aria-label="Toggle light and dark mode">
        {#if theme === 'dark'}
          <IconSun size={16} stroke={1.8} />
          <span>Light</span>
        {:else}
          <IconMoonStars size={16} stroke={1.8} />
          <span>Dark</span>
        {/if}
      </button>
    </div>
  </header>
  <main class="content">
    <slot />
  </main>
</div>

<style>
  :global(:root) {
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
    --surface-border: rgba(149, 164, 255, 0.2);
    --shadow-color: rgba(2, 6, 24, 0.45);
    --primary: #9a8bff;
    --primary-strong: #8573ff;
    --primary-soft: rgba(154, 139, 255, 0.2);
    --primary-contrast: #f6f8ff;
    --button-bg: linear-gradient(135deg, #6f63ff 0%, #8f6dff 100%);
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
    --surface: rgba(255, 255, 255, 0.84);
    --surface-strong: rgba(255, 255, 255, 0.92);
    --surface-soft: rgba(244, 247, 255, 0.86);
    --surface-border: rgba(98, 112, 191, 0.24);
    --shadow-color: rgba(35, 49, 122, 0.16);
    --primary: #6351ef;
    --primary-strong: #5442d8;
    --primary-soft: rgba(99, 81, 239, 0.14);
    --primary-contrast: #f8f9ff;
    --button-bg: linear-gradient(135deg, #4f62e9 0%, #6345df 100%);
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
    display: flex;
    flex-direction: column;
  }

  .top-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem 2.5rem;
    background: var(--surface);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--surface-border);
  }

  .brand {
    font-family: 'Source Serif 4', serif;
    font-size: 1.5rem;
    letter-spacing: 0.02em;
  }

  .brand-mark {
    font-weight: 600;
  }

  .brand-accent {
    margin-left: 0.4rem;
    color: var(--primary);
  }

  .top-actions {
    display: flex;
    align-items: center;
    gap: 0.9rem;
  }

  .nav-links {
    display: flex;
    gap: 1.2rem;
    font-size: 0.95rem;
  }

  .nav-links a {
    padding: 0.3rem 0.6rem;
    border-radius: 999px;
    transition: background 0.2s ease;
  }

  .nav-link {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .nav-links a:hover {
    background: var(--primary-soft);
  }

  .settings-menu {
    position: relative;
  }

  .settings-menu summary {
    list-style: none;
    cursor: pointer;
    padding: 0.3rem 0.6rem;
    border-radius: 999px;
    user-select: none;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .settings-menu summary::-webkit-details-marker {
    display: none;
  }

  .settings-menu summary:hover,
  .settings-menu[open] summary {
    background: var(--primary-soft);
  }

  .submenu {
    position: absolute;
    right: 0;
    top: calc(100% + 0.45rem);
    min-width: 150px;
    background: var(--surface-strong);
    border: 1px solid var(--surface-border);
    border-radius: 14px;
    padding: 0.35rem;
    display: grid;
    gap: 0.2rem;
    box-shadow: 0 10px 24px var(--shadow-color);
    z-index: 20;
  }

  .submenu a {
    padding: 0.45rem 0.55rem;
    border-radius: 10px;
  }

  .submenu a:hover {
    background: var(--primary-soft);
  }

  .theme-toggle {
    border: 1px solid var(--ghost-border);
    background: var(--surface-soft);
    color: var(--ghost-color);
    border-radius: 999px;
    padding: 0.35rem 0.75rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    cursor: pointer;
  }

  .content {
    padding: 2.5rem;
    flex: 1;
  }

  @media (max-width: 800px) {
    .top-bar {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
      padding: 1.5rem;
    }

    .top-actions {
      width: 100%;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.8rem;
    }

    .nav-links {
      flex-wrap: wrap;
      gap: 0.6rem;
    }

    .settings-menu {
      width: 100%;
    }

    .submenu {
      position: static;
      margin-top: 0.35rem;
      min-width: 0;
      box-shadow: none;
    }

    .content {
      padding: 1.5rem;
    }
  }
</style>
