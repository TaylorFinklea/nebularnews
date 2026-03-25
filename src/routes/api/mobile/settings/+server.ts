import { json } from '@sveltejs/kit';
import { requireMobileAccess } from '$lib/server/mobile/auth';
import {
  clampSchedulerPollIntervalMinutes,
  clampNewsBriefLookbackHours,
  clampNewsBriefScoreCutoff,
  clampDashboardQueueLimit,
  clampRetentionArchiveDays,
  clampRetentionDeleteDays,
  getSchedulerPollIntervalMinutes,
  getSetting,
  setSetting,
  getScoringMethod,
  getNewsBriefConfig,
  getDashboardQueueConfig,
  getRetentionConfig,
  parseBooleanSetting,
  validateNewsBriefTimezone,
  validateNewsBriefTime
} from '$lib/server/settings';

const validSummaryStyles = new Set(['concise', 'detailed', 'bullet']);
const validScoringMethods = new Set(['ai', 'algorithmic', 'hybrid']);

async function aggregateSettings(db: D1Database) {
  const [pollIntervalMinutes, summaryStyle, scoringMethod, newsBriefConfig, queueConfig, retention] =
    await Promise.all([
      getSchedulerPollIntervalMinutes(db),
      getSetting(db, 'summary_style').then((v) => v ?? 'concise'),
      getScoringMethod(db),
      getNewsBriefConfig(db),
      getDashboardQueueConfig(db),
      getRetentionConfig(db)
    ]);
  return {
    pollIntervalMinutes,
    summaryStyle,
    scoringMethod,
    newsBriefConfig,
    upNextLimit: queueConfig.limit,
    retentionArchiveDays: retention.archiveDays,
    retentionDeleteDays: retention.deleteDays
  };
}

export const GET = async ({ request, platform }) => {
  const { user } = await requireMobileAccess(request, platform.env, platform.env.DB, 'app:read');
  void user;
  const settings = await aggregateSettings(platform.env.DB);
  return json(settings);
};

export const PATCH = async ({ request, platform }) => {
  const { user } = await requireMobileAccess(request, platform.env, platform.env.DB, 'app:write');
  void user;
  const body = await request.json().catch(() => ({}));
  const entries: [string, string][] = [];

  if (body?.pollIntervalMinutes !== undefined && body?.pollIntervalMinutes !== null) {
    entries.push([
      'scheduler_poll_interval_min',
      String(clampSchedulerPollIntervalMinutes(body.pollIntervalMinutes))
    ]);
  }

  if (body?.summaryStyle && validSummaryStyles.has(body.summaryStyle)) {
    entries.push(['summary_style', body.summaryStyle]);
  }

  if (body?.scoringMethod && validScoringMethods.has(body.scoringMethod)) {
    entries.push(['scoring_method', body.scoringMethod]);
  }

  if (body?.upNextLimit !== undefined && body?.upNextLimit !== null) {
    entries.push(['dashboard_queue_limit', String(clampDashboardQueueLimit(body.upNextLimit))]);
  }

  if (body?.retentionArchiveDays !== undefined && body?.retentionArchiveDays !== null) {
    entries.push(['retention_days', String(clampRetentionArchiveDays(body.retentionArchiveDays))]);
  }

  if (body?.retentionDeleteDays !== undefined && body?.retentionDeleteDays !== null) {
    entries.push(['retention_delete_days', String(clampRetentionDeleteDays(body.retentionDeleteDays))]);
  }

  if (body?.newsBriefConfig !== undefined && body?.newsBriefConfig !== null) {
    const nbc = body.newsBriefConfig;

    if (nbc.enabled !== undefined && nbc.enabled !== null) {
      entries.push(['news_brief_enabled', parseBooleanSetting(nbc.enabled, true) ? '1' : '0']);
    }

    if (nbc.timezone !== undefined && nbc.timezone !== null) {
      const timezone = validateNewsBriefTimezone(nbc.timezone);
      if (!timezone) {
        return json({ error: 'News Brief timezone must be a valid IANA timezone.' }, { status: 400 });
      }
      entries.push(['news_brief_timezone', timezone]);
    }

    const nextMorningTime =
      nbc.morningTime !== undefined && nbc.morningTime !== null
        ? validateNewsBriefTime(nbc.morningTime)
        : null;
    if (nbc.morningTime !== undefined && nbc.morningTime !== null && !nextMorningTime) {
      return json({ error: 'News Brief morning time must use HH:mm format.' }, { status: 400 });
    }

    const nextEveningTime =
      nbc.eveningTime !== undefined && nbc.eveningTime !== null
        ? validateNewsBriefTime(nbc.eveningTime)
        : null;
    if (nbc.eveningTime !== undefined && nbc.eveningTime !== null && !nextEveningTime) {
      return json({ error: 'News Brief evening time must use HH:mm format.' }, { status: 400 });
    }

    if (nextMorningTime !== null || nextEveningTime !== null) {
      const current = await getNewsBriefConfig(platform.env.DB);
      const morningTime = nextMorningTime ?? current.morningTime;
      const eveningTime = nextEveningTime ?? current.eveningTime;
      if (morningTime >= eveningTime) {
        return json(
          { error: 'News Brief morning time must be earlier than evening time.' },
          { status: 400 }
        );
      }
      if (nextMorningTime !== null) entries.push(['news_brief_morning_time', nextMorningTime]);
      if (nextEveningTime !== null) entries.push(['news_brief_evening_time', nextEveningTime]);
    }

    if (nbc.lookbackHours !== undefined && nbc.lookbackHours !== null) {
      entries.push([
        'news_brief_lookback_hours',
        String(clampNewsBriefLookbackHours(nbc.lookbackHours))
      ]);
    }

    if (nbc.scoreCutoff !== undefined && nbc.scoreCutoff !== null) {
      entries.push([
        'news_brief_score_cutoff',
        String(clampNewsBriefScoreCutoff(nbc.scoreCutoff))
      ]);
    }
  }

  for (const [key, value] of entries) {
    await setSetting(platform.env.DB, key, value);
  }

  const settings = await aggregateSettings(platform.env.DB);
  return json(settings);
};
