export type AppNavItemId =
  | 'dashboard'
  | 'articles'
  | 'chat'
  | 'settings'
  | 'tags'
  | 'feeds'
  | 'jobs';

export type AppNavItemIcon =
  | 'layoutDashboard'
  | 'article'
  | 'message'
  | 'settings'
  | 'tag'
  | 'rss'
  | 'clockPlay';

export type AppNavItem = {
  id: AppNavItemId;
  label: string;
  href: string;
  icon: AppNavItemIcon;
  activePrefixes: string[];
  exact?: boolean;
  group: 'primary' | 'workspace';
  mobilePrimary: boolean;
};

export const APP_NAV_ITEMS: readonly AppNavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: '/',
    icon: 'layoutDashboard',
    activePrefixes: ['/'],
    exact: true,
    group: 'primary',
    mobilePrimary: true
  },
  {
    id: 'articles',
    label: 'Articles',
    href: '/articles',
    icon: 'article',
    activePrefixes: ['/articles'],
    group: 'primary',
    mobilePrimary: true
  },
  {
    id: 'chat',
    label: 'Chat',
    href: '/chat',
    icon: 'message',
    activePrefixes: ['/chat'],
    group: 'primary',
    mobilePrimary: true
  },
  {
    id: 'settings',
    label: 'Settings',
    href: '/settings',
    icon: 'settings',
    activePrefixes: ['/settings', '/tags', '/feeds', '/jobs'],
    group: 'primary',
    mobilePrimary: true
  },
  {
    id: 'tags',
    label: 'Tags',
    href: '/tags',
    icon: 'tag',
    activePrefixes: ['/tags'],
    group: 'workspace',
    mobilePrimary: false
  },
  {
    id: 'feeds',
    label: 'Feeds',
    href: '/feeds',
    icon: 'rss',
    activePrefixes: ['/feeds'],
    group: 'workspace',
    mobilePrimary: false
  },
  {
    id: 'jobs',
    label: 'Jobs',
    href: '/jobs',
    icon: 'clockPlay',
    activePrefixes: ['/jobs'],
    group: 'workspace',
    mobilePrimary: false
  }
];

export const isAppNavItemActive = (item: AppNavItem, pathname: string) => {
  const normalizedPath = pathname || '/';

  if (item.exact) {
    return normalizedPath === item.href;
  }

  return item.activePrefixes.some((prefix) => {
    if (prefix === '/') return normalizedPath === '/';
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  });
};
