import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbAll, dbRun, dbBatch } from '../db/helpers';

export const settingsRoutes = new Hono<AppEnv>();

interface SettingRow {
  key: string;
  value: string;
}

const DEFAULTS: Record<string, string> = {
  pollIntervalMinutes: '15',
  summaryStyle: 'concise',
  scoringMethod: 'ai',
  upNextLimit: '6',
  retentionArchiveDays: '30',
  retentionDeleteDays: '90',
  newsBriefEnabled: 'true',
  newsBriefTimezone: 'UTC',
  newsBriefMorningTime: '08:00',
  newsBriefEveningTime: '17:00',
  newsBriefLookbackHours: '12',
  newsBriefScoreCutoff: '3',
};

// GET /settings — read all user settings with defaults
settingsRoutes.get('/settings', async (c) => {
  const userId = c.get('userId');
  const rows = await dbAll<SettingRow>(
    c.env.DB,
    `SELECT key, value FROM settings WHERE user_id = ?`,
    [userId],
  );

  const stored: Record<string, string> = {};
  for (const row of rows) {
    stored[row.key] = row.value;
  }

  const merged = { ...DEFAULTS, ...stored };

  return c.json({
    ok: true,
    data: {
      poll_interval_minutes: parseInt(merged.pollIntervalMinutes, 10),
      summary_style: merged.summaryStyle,
      scoring_method: merged.scoringMethod,
      up_next_limit: parseInt(merged.upNextLimit, 10),
      retention_archive_days: parseInt(merged.retentionArchiveDays, 10),
      retention_delete_days: parseInt(merged.retentionDeleteDays, 10),
      news_brief_config: {
        enabled: merged.newsBriefEnabled === 'true',
        timezone: merged.newsBriefTimezone,
        morning_time: merged.newsBriefMorningTime,
        evening_time: merged.newsBriefEveningTime,
        lookback_hours: parseInt(merged.newsBriefLookbackHours, 10),
        score_cutoff: parseInt(merged.newsBriefScoreCutoff, 10),
      },
    },
  });
});

// PUT /settings — upsert all settings
settingsRoutes.put('/settings', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    pollIntervalMinutes?: number;
    summaryStyle?: string;
    scoringMethod?: string;
    upNextLimit?: number;
    retentionArchiveDays?: number;
    retentionDeleteDays?: number;
    newsBriefConfig?: {
      enabled?: boolean;
      timezone?: string;
      morningTime?: string;
      eveningTime?: string;
      lookbackHours?: number;
      scoreCutoff?: number;
    };
  }>();

  const pairs: [string, string][] = [];

  if (body.pollIntervalMinutes !== undefined)
    pairs.push(['pollIntervalMinutes', String(body.pollIntervalMinutes)]);
  if (body.summaryStyle !== undefined)
    pairs.push(['summaryStyle', body.summaryStyle]);
  if (body.scoringMethod !== undefined)
    pairs.push(['scoringMethod', body.scoringMethod]);
  if (body.upNextLimit !== undefined)
    pairs.push(['upNextLimit', String(body.upNextLimit)]);
  if (body.retentionArchiveDays !== undefined)
    pairs.push(['retentionArchiveDays', String(body.retentionArchiveDays)]);
  if (body.retentionDeleteDays !== undefined)
    pairs.push(['retentionDeleteDays', String(body.retentionDeleteDays)]);

  const brief = body.newsBriefConfig;
  if (brief) {
    if (brief.enabled !== undefined)
      pairs.push(['newsBriefEnabled', String(brief.enabled)]);
    if (brief.timezone !== undefined)
      pairs.push(['newsBriefTimezone', brief.timezone]);
    if (brief.morningTime !== undefined)
      pairs.push(['newsBriefMorningTime', brief.morningTime]);
    if (brief.eveningTime !== undefined)
      pairs.push(['newsBriefEveningTime', brief.eveningTime]);
    if (brief.lookbackHours !== undefined)
      pairs.push(['newsBriefLookbackHours', String(brief.lookbackHours)]);
    if (brief.scoreCutoff !== undefined)
      pairs.push(['newsBriefScoreCutoff', String(brief.scoreCutoff)]);
  }

  if (pairs.length === 0) return c.json({ ok: true, data: null });

  const now = Date.now();
  const statements = pairs.map(([key, value]) => ({
    sql: `INSERT INTO settings (id, user_id, key, value, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    params: [nanoid(), userId, key, value, now] as unknown[],
  }));

  await dbBatch(c.env.DB, statements);

  // Re-read all settings and return full merged object (same shape as GET)
  const rows = await dbAll<SettingRow>(
    c.env.DB,
    `SELECT key, value FROM settings WHERE user_id = ?`,
    [userId],
  );
  const stored: Record<string, string> = {};
  for (const row of rows) {
    stored[row.key] = row.value;
  }
  const merged = { ...DEFAULTS, ...stored };

  return c.json({
    ok: true,
    data: {
      poll_interval_minutes: parseInt(merged.pollIntervalMinutes, 10),
      summary_style: merged.summaryStyle,
      scoring_method: merged.scoringMethod,
      up_next_limit: parseInt(merged.upNextLimit, 10),
      retention_archive_days: parseInt(merged.retentionArchiveDays, 10),
      retention_delete_days: parseInt(merged.retentionDeleteDays, 10),
      news_brief_config: {
        enabled: merged.newsBriefEnabled === 'true',
        timezone: merged.newsBriefTimezone,
        morning_time: merged.newsBriefMorningTime,
        evening_time: merged.newsBriefEveningTime,
        lookback_hours: parseInt(merged.newsBriefLookbackHours, 10),
        score_cutoff: parseInt(merged.newsBriefScoreCutoff, 10),
      },
    },
  });
});
