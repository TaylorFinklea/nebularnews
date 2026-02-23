export type PullStatusEventPayload = {
  run_id: string | null;
  status: string | null;
  in_progress: boolean;
  started_at: number | null;
  completed_at: number | null;
  last_run_status: 'success' | 'failed' | null;
  last_error: string | null;
};

export type JobsCountsEventPayload = {
  pending: number;
  running: number;
  failed: number;
  done: number;
  cancelled?: number;
};

export type ArticleMutatedEventPayload = {
  article_id: string;
  fields: string[];
  mutated_at: number;
};

export type NebularEventV2 =
  | { type: 'pull.status'; pull: PullStatusEventPayload; ts: number; throttled: boolean }
  | { type: 'jobs.counts'; jobs: JobsCountsEventPayload; ts: number; throttled: boolean }
  | { type: 'article.mutated'; article: ArticleMutatedEventPayload; ts: number; throttled: boolean };
