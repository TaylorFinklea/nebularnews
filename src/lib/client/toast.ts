import { writable } from 'svelte/store';

interface Toast {
  id: string;
  message: string;
  variant: 'info' | 'success' | 'error';
}

export const toasts = writable<Toast[]>([]);

export const showToast = (
  message: string,
  variant: 'info' | 'success' | 'error' = 'info',
  durationMs = 4000
) => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  toasts.update((t) => [...t, { id, message, variant }]);
  setTimeout(() => {
    toasts.update((t) => t.filter((toast) => toast.id !== id));
  }, durationMs);
};

export const dismissToast = (id: string) => {
  toasts.update((t) => t.filter((toast) => toast.id !== id));
};
