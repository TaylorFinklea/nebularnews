<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { fade } from 'svelte/transition';
  import '$lib/styles/tokens.css';
  import {
    IconArticle,
    IconLayoutDashboard,
    IconMenu2,
    IconMessage2,
    IconMoonStars,
    IconSettings,
    IconSun,
    IconX
  } from '$lib/icons';
  import Toast from '$lib/components/Toast.svelte';

  const THEME_KEY = 'nebular-theme';
  let theme = 'dark';
  let settingsMenu;
  let mobileMenuOpen = false;

  $: currentPath = $page.url.pathname;
  $: isActive = (href) => {
    if (href === '/') return currentPath === '/';
    return currentPath.startsWith(href);
  };
  $: isSettingsActive = ['/settings', '/tags', '/feeds', '/jobs'].some(
    (p) => currentPath.startsWith(p)
  );
  // Auto-close mobile menu and settings dropdown on route change
  $: currentPath, (() => {
    mobileMenuOpen = false;
    closeSettingsMenu();
  })();

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
  const toggleMobileMenu = () => {
    mobileMenuOpen = !mobileMenuOpen;
  };

  onMount(() => {
    setTheme(resolveInitialTheme(), false);
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
    <div class="top-bar-inner">
      <a href="/" class="brand">
        <span class="brand-mark">Nebular</span>
        <span class="brand-accent">News</span>
      </a>

      <!-- Desktop nav -->
      <div class="top-actions desktop-only">
        <nav class="nav-links">
          <a href="/" class="nav-link" class:active={isActive('/')}>
            <IconLayoutDashboard size={16} stroke={1.9} />
            <span>Dashboard</span>
          </a>
          <a href="/articles" class="nav-link" class:active={isActive('/articles')}>
            <IconArticle size={16} stroke={1.9} />
            <span>Articles</span>
          </a>
          <a href="/chat" class="nav-link" class:active={isActive('/chat')}>
            <IconMessage2 size={16} stroke={1.9} />
            <span>Chat</span>
          </a>
          <details class="settings-menu" bind:this={settingsMenu}>
            <summary class:active={isSettingsActive}>
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

      <!-- Mobile hamburger -->
      <div class="mobile-controls mobile-only">
        <button class="theme-toggle compact" on:click={toggleTheme} aria-label="Toggle theme">
          {#if theme === 'dark'}
            <IconSun size={16} stroke={1.8} />
          {:else}
            <IconMoonStars size={16} stroke={1.8} />
          {/if}
        </button>
        <button
          class="hamburger"
          on:click={toggleMobileMenu}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
        >
          {#if mobileMenuOpen}
            <IconX size={20} stroke={2} />
          {:else}
            <IconMenu2 size={20} stroke={2} />
          {/if}
        </button>
      </div>
    </div>
  </header>

  <!-- Mobile nav overlay -->
  {#if mobileMenuOpen}
    <button class="mobile-overlay" on:click={() => (mobileMenuOpen = false)} transition:fade={{ duration: 150 }} aria-label="Close menu"></button>
  {/if}
  <nav class="mobile-nav" class:open={mobileMenuOpen} aria-label="Mobile navigation">
    <a href="/" class="mobile-link" class:active={isActive('/')}>
      <IconLayoutDashboard size={18} stroke={1.9} />
      <span>Dashboard</span>
    </a>
    <a href="/articles" class="mobile-link" class:active={isActive('/articles')}>
      <IconArticle size={18} stroke={1.9} />
      <span>Articles</span>
    </a>
    <a href="/chat" class="mobile-link" class:active={isActive('/chat')}>
      <IconMessage2 size={18} stroke={1.9} />
      <span>Chat</span>
    </a>
    <div class="mobile-divider"></div>
    <a href="/settings" class="mobile-link" class:active={isActive('/settings')}>
      <IconSettings size={18} stroke={1.9} />
      <span>Settings</span>
    </a>
    <a href="/tags" class="mobile-link" class:active={currentPath.startsWith('/tags')}>
      <span>Tags</span>
    </a>
    <a href="/feeds" class="mobile-link" class:active={currentPath.startsWith('/feeds')}>
      <span>Feeds</span>
    </a>
    <a href="/jobs" class="mobile-link" class:active={currentPath.startsWith('/jobs')}>
      <span>Jobs</span>
    </a>
  </nav>

  <main class="content">
    {#key currentPath}
      <div in:fade={{ duration: 120, delay: 40 }}>
        <slot />
      </div>
    {/key}
  </main>
</div>

<Toast />

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
    background: var(--surface);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--surface-border);
    position: sticky;
    top: 0;
    z-index: 50;
  }

  .top-bar-inner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-4) var(--space-10);
    max-width: var(--content-max-width);
    margin: 0 auto;
    width: 100%;
  }

  .brand {
    font-family: 'Source Serif 4', serif;
    font-size: 1.5rem;
    letter-spacing: 0.02em;
    display: flex;
    gap: 0.4rem;
  }

  .brand-mark {
    font-weight: 600;
  }

  .brand-accent {
    color: var(--primary);
  }

  .top-actions {
    display: flex;
    align-items: center;
    gap: 0.9rem;
  }

  .nav-links {
    display: flex;
    gap: var(--space-2);
    font-size: 0.95rem;
  }

  .nav-links a,
  .nav-links .settings-menu summary {
    padding: 0.35rem 0.7rem;
    border-radius: var(--radius-full);
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .nav-link {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .nav-links a:hover,
  .nav-links .settings-menu summary:hover {
    background: var(--primary-soft);
  }

  .nav-links a.active,
  .nav-links .settings-menu summary.active {
    background: var(--primary-soft);
    color: var(--primary);
    font-weight: 600;
  }

  .settings-menu {
    position: relative;
  }

  .settings-menu summary {
    list-style: none;
    cursor: pointer;
    user-select: none;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .settings-menu summary::-webkit-details-marker {
    display: none;
  }

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
    box-shadow: var(--shadow-md);
    z-index: 20;
  }

  .submenu a {
    padding: 0.45rem 0.55rem;
    border-radius: 10px;
    transition: background var(--transition-fast);
  }

  .submenu a:hover {
    background: var(--primary-soft);
  }

  .theme-toggle {
    border: 1px solid var(--ghost-border);
    background: var(--surface-soft);
    color: var(--ghost-color);
    border-radius: var(--radius-full);
    padding: 0.35rem 0.75rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .theme-toggle:hover {
    background: var(--primary-soft);
  }

  .theme-toggle.compact {
    padding: 0.35rem;
  }

  .content {
    padding: var(--content-padding);
    flex: 1;
    max-width: var(--content-max-width);
    margin: 0 auto;
    width: 100%;
  }

  /* Mobile controls */
  .mobile-controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .hamburger {
    border: 1px solid var(--ghost-border);
    background: var(--surface-soft);
    color: var(--ghost-color);
    border-radius: var(--radius-full);
    width: 2.4rem;
    height: 2.4rem;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  /* Mobile overlay */
  .mobile-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 90;
    border: none;
    cursor: pointer;
  }

  /* Mobile nav drawer */
  .mobile-nav {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(300px, 80vw);
    background: var(--surface-strong);
    backdrop-filter: blur(16px);
    border-left: 1px solid var(--surface-border);
    z-index: 100;
    padding: var(--space-10) var(--space-6);
    display: grid;
    gap: var(--space-1);
    align-content: start;
    transform: translateX(100%);
    transition: transform var(--transition-slow);
  }

  .mobile-nav.open {
    transform: translateX(0);
  }

  .mobile-link {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--text-md);
    transition: background var(--transition-fast);
  }

  .mobile-link:hover {
    background: var(--primary-soft);
  }

  .mobile-link.active {
    background: var(--primary-soft);
    color: var(--primary);
    font-weight: 600;
  }

  .mobile-divider {
    height: 1px;
    background: var(--surface-border);
    margin: var(--space-2) 0;
  }

  /* Responsive visibility */
  .desktop-only {
    display: flex;
  }

  .mobile-only {
    display: none;
  }

  @media (max-width: 800px) {
    .desktop-only {
      display: none !important;
    }

    .mobile-only {
      display: flex !important;
    }

    .top-bar-inner {
      padding: var(--space-4) var(--space-6);
    }
  }
</style>
