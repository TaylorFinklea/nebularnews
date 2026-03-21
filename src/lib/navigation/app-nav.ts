export type AppNavItemId =
  | 'today'
  | 'articles'
  | 'discover'
  | 'lists'
  | 'settings';

export type AppNavItemIcon =
  | 'sun'
  | 'article'
  | 'compass'
  | 'bookmark'
  | 'settings';

export type AppNavItem = {
  id: AppNavItemId;
  label: string;
  href: string;
  icon: AppNavItemIcon;
  activePrefixes: string[];
  exact?: boolean;
  group: 'primary';
  mobilePrimary: boolean;
};

export const APP_NAV_ITEMS: readonly AppNavItem[] = [
  {
    id: 'today',
    label: 'Today',
    href: '/',
    icon: 'sun',
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
    id: 'discover',
    label: 'Discover',
    href: '/discover',
    icon: 'compass',
    activePrefixes: ['/discover'],
    group: 'primary',
    mobilePrimary: true
  },
  {
    id: 'lists',
    label: 'Lists',
    href: '/lists',
    icon: 'bookmark',
    activePrefixes: ['/lists'],
    group: 'primary',
    mobilePrimary: true
  },
  {
    id: 'settings',
    label: 'Settings',
    href: '/settings',
    icon: 'settings',
    activePrefixes: ['/settings'],
    group: 'primary',
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
