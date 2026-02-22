import { writable } from 'svelte/store';
import type {
  ArticleMutatedEventPayload,
  JobsCountsEventPayload,
  PullStatusEventPayload
} from '$lib/types/events';

export type LivePullState = {
  run_id: string | null;
  status: string | null;
  in_progress: boolean;
  started_at: number | null;
  completed_at: number | null;
  last_run_status: 'success' | 'failed' | null;
  last_error: string | null;
};

export type LiveJobState = {
  pending: number;
  running: number;
  failed: number;
  done: number;
};

export type LiveEventSnapshot = {
  connected: boolean;
  lastEventAt: number | null;
  pull: LivePullState | null;
  jobs: LiveJobState | null;
  lastArticleMutation: ArticleMutatedEventPayload | null;
  error: string | null;
};

const initialState: LiveEventSnapshot = {
  connected: false,
  lastEventAt: null,
  pull: null,
  jobs: null,
  lastArticleMutation: null,
  error: null
};

export const liveEvents = writable<LiveEventSnapshot>(initialState);

let source: EventSource | null = null;
let subscribers = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;

const closeSource = () => {
  if (source) {
    source.close();
    source = null;
  }
};

const clearReconnect = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

const scheduleReconnect = () => {
  clearReconnect();
  reconnectAttempt += 1;
  const delayMs = Math.min(10_000, 1000 * 2 ** Math.max(0, reconnectAttempt - 1));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delayMs);
};

const connect = () => {
  if (typeof window === 'undefined') return;
  if (source || subscribers <= 0) return;

  const next = new EventSource('/api/events');
  source = next;

  next.addEventListener('open', () => {
    reconnectAttempt = 0;
    liveEvents.update((state) => ({
      ...state,
      connected: true,
      error: null
    }));
  });

  next.addEventListener('pull.status', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        pull?: PullStatusEventPayload;
      };
      if (!payload.pull) return;
      liveEvents.update((state) => ({
        ...state,
        connected: true,
        lastEventAt: Date.now(),
        pull: payload.pull,
        error: null
      }));
    } catch {
      liveEvents.update((state) => ({
        ...state,
        error: 'Failed to parse pull status event'
      }));
    }
  });

  next.addEventListener('jobs.counts', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        jobs?: JobsCountsEventPayload;
      };
      if (!payload.jobs) return;
      liveEvents.update((state) => ({
        ...state,
        connected: true,
        lastEventAt: Date.now(),
        jobs: payload.jobs,
        error: null
      }));
    } catch {
      liveEvents.update((state) => ({
        ...state,
        error: 'Failed to parse jobs counts event'
      }));
    }
  });

  next.addEventListener('article.mutated', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        article?: ArticleMutatedEventPayload;
      };
      if (!payload.article) return;
      liveEvents.update((state) => ({
        ...state,
        connected: true,
        lastEventAt: Date.now(),
        lastArticleMutation: payload.article,
        error: null
      }));
    } catch {
      liveEvents.update((state) => ({
        ...state,
        error: 'Failed to parse article mutation event'
      }));
    }
  });

  next.addEventListener('state', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        pull?: LivePullState;
        jobs?: LiveJobState;
      };
      liveEvents.update((state) => ({
        ...state,
        connected: true,
        lastEventAt: Date.now(),
        pull: payload.pull ?? state.pull,
        jobs: payload.jobs ?? state.jobs,
        error: null
      }));
    } catch {
      liveEvents.update((state) => ({
        ...state,
        error: 'Failed to parse live event payload'
      }));
    }
  });

  next.addEventListener('error', () => {
    liveEvents.update((state) => ({
      ...state,
      connected: false,
      error: 'Live updates disconnected. Reconnecting...'
    }));
    closeSource();
    if (subscribers > 0) {
      scheduleReconnect();
    }
  });
};

export const startLiveEvents = () => {
  if (typeof window === 'undefined') {
    return () => {};
  }

  subscribers += 1;
  connect();

  return () => {
    subscribers = Math.max(0, subscribers - 1);
    if (subscribers === 0) {
      clearReconnect();
      closeSource();
      reconnectAttempt = 0;
      liveEvents.set(initialState);
    }
  };
};
