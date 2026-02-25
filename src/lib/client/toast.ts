import { get, writable } from 'svelte/store';

interface Toast {
  id: string;
  message: string;
  variant: 'info' | 'success' | 'error';
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const toasts = writable<Toast[]>([]);
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const showToast = (
  message: string,
  variant: 'info' | 'success' | 'error' = 'info',
  options: number | { durationMs?: number; action?: Toast['action'] } = 4000
) => {
  const durationMs =
    typeof options === 'number'
      ? options
      : Number.isFinite(options?.durationMs)
        ? Number(options.durationMs)
        : 4000;
  const action = typeof options === 'number' ? undefined : options?.action;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  toasts.update((t) => [...t, { id, message, variant, action }]);
  const timer = setTimeout(() => {
    dismissToast(id);
  }, Math.max(0, durationMs));
  toastTimers.set(id, timer);
};

export const dismissToast = (id: string) => {
  const timer = toastTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    toastTimers.delete(id);
  }
  toasts.update((t) => t.filter((toast) => toast.id !== id));
};

export const runToastAction = (id: string) => {
  const toast = get(toasts).find((entry) => entry.id === id);
  dismissToast(id);
  try {
    toast?.action?.onClick?.();
  } catch {
    // Ignore callback exceptions to keep toast UX safe.
  }
};
