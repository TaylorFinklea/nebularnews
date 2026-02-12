<svelte:head>
  <title>Nebular News</title>
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&family=Source+Serif+4:wght@400;600&display=swap"
  />
</svelte:head>

<div class="app-shell">
  <header class="top-bar">
    <div class="brand">
      <span class="brand-mark">Nebular</span>
      <span class="brand-accent">News</span>
    </div>
    <nav class="nav-links">
      <a href="/">Dashboard</a>
      <a href="/feeds">Feeds</a>
      <a href="/articles">Articles</a>
      <a href="/jobs">Jobs</a>
      <a href="/chat">Chat</a>
      <a href="/settings">Settings</a>
    </nav>
  </header>
  <main class="content">
    <slot />
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: 'Space Grotesk', system-ui, sans-serif;
    background: radial-gradient(circle at top, #f5f0e6, #f2e6d8 45%, #f8f6f2 100%);
    color: #1f1f1f;
  }

  :global(a) {
    color: inherit;
    text-decoration: none;
  }

  :global(button) {
    font-family: inherit;
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
    background: rgba(255, 255, 255, 0.7);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
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
    color: #c55b2a;
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

  .nav-links a:hover {
    background: rgba(197, 91, 42, 0.15);
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

    .nav-links {
      flex-wrap: wrap;
      gap: 0.6rem;
    }

    .content {
      padding: 1.5rem;
    }
  }
</style>
