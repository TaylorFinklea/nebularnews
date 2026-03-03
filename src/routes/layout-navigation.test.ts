// @vitest-environment jsdom
// @ts-nocheck
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from './+layout.svelte';

const mockedPage = vi.hoisted(() => {
  const afterNavigateCallbacks = new Set<(navigation: { to: { url: URL } | null }) => void>();
  const page = { url: new URL('https://example.com/') };

  return {
    page,
    afterNavigate(callback: (navigation: { to: { url: URL } | null }) => void) {
      afterNavigateCallbacks.add(callback);
    },
    setPath(pathname: string) {
      page.url = new URL(`https://example.com${pathname}`);
      for (const callback of afterNavigateCallbacks) {
        callback({ to: { url: page.url } });
      }
    }
  };
});

vi.mock('$app/state', () => ({
  page: mockedPage.page
}));

vi.mock('$app/navigation', () => ({
  afterNavigate: mockedPage.afterNavigate
}));

const setPath = (pathname: string) => mockedPage.setPath(pathname);
const createLocalStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
};

describe('Layout navigation shell', () => {
  beforeEach(() => {
    cleanup();
    // Polyfill Web Animations API for JSDOM (Svelte transitions use element.animate)
    if (!Element.prototype.animate) {
      Element.prototype.animate = vi.fn().mockImplementation(() => {
        const anim = {
          onfinish: null as (() => void) | null,
          cancel: vi.fn(),
          finish: vi.fn(),
          play: vi.fn(),
          pause: vi.fn(),
          reverse: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          finished: Promise.resolve()
        };
        // Fire onfinish asynchronously so Svelte cleans up transition elements
        queueMicrotask(() => { if (anim.onfinish) anim.onfinish(); });
        return anim;
      });
    }
    vi.stubGlobal('localStorage', createLocalStorage());
    document.cookie = '';
    document.documentElement.dataset.theme = 'dark';
    setPath('/');
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders expected sidebar links', async () => {
    render(Layout);

    const sidebar = await screen.findByLabelText('App sidebar');
    const sidebarScope = within(sidebar);

    expect(sidebarScope.getByRole('link', { name: 'Dashboard' })).toBeTruthy();
    expect(sidebarScope.getByRole('link', { name: 'Articles' })).toBeTruthy();
    expect(sidebarScope.getByRole('link', { name: 'Chat' })).toBeTruthy();
    expect(sidebarScope.getByRole('link', { name: 'Settings' })).toBeTruthy();
    expect(sidebarScope.getByRole('link', { name: 'Tags' })).toBeTruthy();
    expect(sidebarScope.getByRole('link', { name: 'Feeds' })).toBeTruthy();
    expect(sidebarScope.getByRole('link', { name: 'Jobs' })).toBeTruthy();
  });

  it('persists collapsed sidebar state and restores it on mount', async () => {
    const firstRender = render(Layout);

    const collapseButton = await screen.findByRole('button', { name: 'Collapse sidebar' });
    await fireEvent.click(collapseButton);
    expect(localStorage.getItem('nebular-sidebar-collapsed')).toBe('1');
    expect(document.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(true);

    firstRender.unmount();
    render(Layout);

    await waitFor(() => {
      expect(document.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(true);
    });
  });

  it('marks settings as active on settings-family routes', async () => {
    setPath('/tags');
    render(Layout);

    const sidebar = await screen.findByLabelText('App sidebar');
    const settingsLink = within(sidebar).getByRole('link', { name: 'Settings' });
    expect(settingsLink.getAttribute('aria-current')).toBe('page');
  });

  it('updates the active sidebar link after client-side navigation', async () => {
    render(Layout);

    const sidebar = await screen.findByLabelText('App sidebar');
    const sidebarScope = within(sidebar);

    expect(sidebarScope.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBe(
      'page'
    );
    expect(sidebarScope.getByRole('link', { name: 'Articles' }).getAttribute('aria-current')).toBeNull();

    setPath('/articles');

    await waitFor(() => {
      expect(
        sidebarScope.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')
      ).toBeNull();
      expect(sidebarScope.getByRole('link', { name: 'Articles' }).getAttribute('aria-current')).toBe(
        'page'
      );
    });
  });

  it('opens and closes mobile more sheet with management links', async () => {
    render(Layout);

    const moreButton = await screen.findByRole('button', { name: 'More navigation' });
    await fireEvent.click(moreButton);

    const dialog = await screen.findByRole('dialog', { name: 'More navigation' });
    expect(within(dialog).getByRole('link', { name: 'Tags' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Feeds' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Jobs' })).toBeTruthy();

    await waitFor(() => {
      expect(document.activeElement?.getAttribute('href')).toBe('/tags');
    });

    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'More navigation' })).toBeNull();
    });
  });

  it('hides sidebar and bottom rail on login route', () => {
    setPath('/login');
    render(Layout);

    expect(screen.queryByLabelText('App sidebar')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Bottom navigation' })).toBeNull();
  });

  it('keeps browser theme metadata in sync with the active theme', async () => {
    localStorage.setItem('nebular-theme', 'dark');
    render(Layout);

    await waitFor(() => {
      expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
        '#030711'
      );
      expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe(
        'dark light'
      );
      expect(document.documentElement.style.colorScheme).toBe('dark');
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'Light mode' }));

    await waitFor(() => {
      expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
        '#f8f7fc'
      );
      expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe(
        'light dark'
      );
      expect(
        document
          .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
          ?.getAttribute('content')
      ).toBe('default');
      expect(document.documentElement.style.colorScheme).toBe('light');
      expect(localStorage.getItem('nebular-theme')).toBe('light');
    });
  });
});
