import { pollFeeds, type FeedPollSummary } from './ingest';
import { processJobs } from './jobs';
import { processPullRuns, recoverStalePullRuns } from './manual-pull';
import { runNewsBriefSchedulerTick } from './news-brief';
import { queueMissingRecentArticleJobs } from './jobs-admin';
import { ensureSchema } from './migrations';
import { assertRuntimeConfig } from './runtime-config';
import { logError, logInfo } from './log';
import { runRetentionCleanup } from './retention';
import {
  DEFAULT_SCHEDULED_ORPHAN_CLEANUP_LIMIT,
  deleteOrphanArticlesBatch
} from './orphan-cleanup';
import {
  getSchedulerRuntimeConfig,
  intervalMinutesToCronExpression
} from './settings';

export const RETENTION_CRON = '30 3 * * *';
export const LEGACY_JOBS_CRON = '*/5 * * * *';
export const LEGACY_POLL_CRON = '0 * * * *';

type SchedulerRuntimeConfig = Awaited<ReturnType<typeof getSchedulerRuntimeConfig>>;

type ScheduledJobsSummary = {
  pullProcessed: boolean;
  pullSlices: number;
  pullStatus: string | null;
  queuedRecent: Awaited<ReturnType<typeof queueMissingRecentArticleJobs>> | null;
  orphanCleanup: Awaited<ReturnType<typeof deleteOrphanArticlesBatch>> | null;
  newsBrief: Awaited<ReturnType<typeof runNewsBriefSchedulerTick>> | null;
};

export type ScheduledRunSummary = {
  cron: string | null;
  runtime: {
    ok: boolean;
    stage: string;
    warnings: string[];
    errors: string[];
  };
  scheduler: SchedulerRuntimeConfig | null;
  triggered: {
    jobs: boolean;
    poll: boolean;
    retention: boolean;
  };
  jobs: ScheduledJobsSummary | null;
  poll: FeedPollSummary | null;
  retention: Awaited<ReturnType<typeof runRetentionCleanup>> | null;
  skipped: 'runtime_config_invalid' | null;
};

const runJobsTick = async (
  env: App.Platform['env'],
  scheduler: SchedulerRuntimeConfig,
  cron: string | null
): Promise<ScheduledJobsSummary> => {
  const startedAt = Date.now();
  await recoverStalePullRuns(env.DB);
  const pull = await processPullRuns(env, {
    maxSlices: scheduler.pullSlicesPerTick,
    timeBudgetMs: scheduler.pullSliceBudgetMs
  });
  const latestPullSlice = pull.slices.length > 0 ? pull.slices[pull.slices.length - 1] : null;
  const pullRunning = latestPullSlice?.status === 'running';
  let queuedRecent = null;
  if (!pullRunning && scheduler.autoQueueTodayMissing) {
    queuedRecent = await queueMissingRecentArticleJobs(env.DB, { lookbackHours: 72 });
  }
  await processJobs(env, {
    timeBudgetMs: pullRunning ? scheduler.jobBudgetWhilePullMs : scheduler.jobBudgetIdleMs
  });
  const newsBrief = await runNewsBriefSchedulerTick(env.DB, env);

  let orphanCleanup = null;
  if (!pullRunning) {
    const orphanCleanupStartedAt = Date.now();
    orphanCleanup = await deleteOrphanArticlesBatch(env.DB, DEFAULT_SCHEDULED_ORPHAN_CLEANUP_LIMIT, {
      dryRun: false
    });
    logInfo('scheduled.orphans.cleanup', {
      cron,
      duration_ms: Date.now() - orphanCleanupStartedAt,
      targeted: orphanCleanup.targeted,
      deleted_articles: orphanCleanup.deleted_articles,
      orphan_count_after: orphanCleanup.orphan_count_after,
      has_more: orphanCleanup.has_more
    });
  }

  const summary: ScheduledJobsSummary = {
    pullProcessed: pull.processed,
    pullSlices: pull.slices.length,
    pullStatus: latestPullSlice?.status ?? null,
    queuedRecent,
    orphanCleanup,
    newsBrief
  };

  logInfo('scheduled.jobs.completed', {
    cron,
    duration_ms: Date.now() - startedAt,
    pull_processed: summary.pullProcessed,
    pull_slices: summary.pullSlices,
    pull_status: summary.pullStatus,
    jobs_processed: true,
    scheduler,
    queued_recent: queuedRecent,
    orphan_cleanup: orphanCleanup,
    news_brief: newsBrief
  });

  return summary;
};

const runRetentionTick = async (env: App.Platform['env'], cron: string | null) => {
  const startedAt = Date.now();
  const stats = await runRetentionCleanup(env);
  logInfo('scheduled.retention.completed', {
    cron,
    duration_ms: Date.now() - startedAt,
    stats
  });
  return stats;
};

const runPollTick = async (
  env: App.Platform['env'],
  scheduler: SchedulerRuntimeConfig,
  cron: string | null
) => {
  const startedAt = Date.now();
  const poll = await pollFeeds(env);
  logInfo('scheduled.poll.completed', {
    cron,
    duration_ms: Date.now() - startedAt,
    scheduler,
    poll
  });
  return poll;
};

export async function runScheduledTasks(
  env: App.Platform['env'],
  options: {
    cron?: string | null;
    runJobs?: boolean;
    runPoll?: boolean;
    runRetention?: boolean;
  } = {}
): Promise<ScheduledRunSummary> {
  const cron = options.cron ?? null;
  const runtime = assertRuntimeConfig(env);
  const baseSummary: ScheduledRunSummary = {
    cron,
    runtime: {
      ok: runtime.ok,
      stage: runtime.stage,
      warnings: runtime.warnings,
      errors: runtime.errors
    },
    scheduler: null,
    triggered: {
      jobs: false,
      poll: false,
      retention: false
    },
    jobs: null,
    poll: null,
    retention: null,
    skipped: null
  };

  if (!runtime.ok && runtime.stage === 'production') {
    logError('scheduled.runtime_config.invalid', {
      stage: runtime.stage,
      errors: runtime.errors
    });
    return {
      ...baseSummary,
      skipped: 'runtime_config_invalid'
    };
  }

  await ensureSchema(env.DB);
  const scheduler = await getSchedulerRuntimeConfig(env.DB);
  const jobsCron = intervalMinutesToCronExpression(scheduler.jobsIntervalMinutes);
  const pollCron = intervalMinutesToCronExpression(scheduler.pollIntervalMinutes);
  const runJobs = options.runJobs ?? (cron === jobsCron || cron === LEGACY_JOBS_CRON);
  const runPoll = options.runPoll ?? (cron === pollCron || cron === LEGACY_POLL_CRON);
  const runRetention = options.runRetention ?? cron === RETENTION_CRON;

  const summary: ScheduledRunSummary = {
    ...baseSummary,
    scheduler,
    triggered: {
      jobs: runJobs,
      poll: runPoll,
      retention: runRetention
    }
  };

  if (runJobs) {
    summary.jobs = await runJobsTick(env, scheduler, cron);
  }

  if (runRetention) {
    summary.retention = await runRetentionTick(env, cron);
  }

  if (runPoll) {
    summary.poll = await runPollTick(env, scheduler, cron);
  }

  return summary;
}
