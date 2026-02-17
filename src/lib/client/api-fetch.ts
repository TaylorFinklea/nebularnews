const readCookie = (name: string) => {
  if (typeof document === 'undefined') return null;
  const cookie = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));
  if (!cookie) return null;
  return decodeURIComponent(cookie.slice(name.length + 1));
};

const isMutating = (method: string) => !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());

export const apiFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  const headers = new Headers(init?.headers ?? {});
  if (isMutating(method)) {
    const csrf = readCookie('nn_csrf');
    if (csrf) headers.set('x-csrf-token', csrf);
  }
  return fetch(input, {
    ...init,
    headers
  });
};

