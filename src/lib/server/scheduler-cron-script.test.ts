import { describe, expect, it } from 'vitest';
import {
  buildEnvCronSet,
  extractEnvCrons,
  intervalMinutesToCronExpression,
  updateEnvTriggerCrons
} from '../../../scripts/apply-scheduler-cron.mjs';

describe('apply-scheduler-cron script helpers', () => {
  it('converts intervals to cron expressions', () => {
    expect(intervalMinutesToCronExpression(5)).toBe('*/5 * * * *');
    expect(intervalMinutesToCronExpression(60)).toBe('0 * * * *');
  });

  it('builds env cron set and preserves retention cron', () => {
    const crons = buildEnvCronSet({
      jobsIntervalMinutes: 10,
      pollIntervalMinutes: 30,
      existingCrons: ['*/5 * * * *', '0 * * * *', '45 2 * * *']
    });

    expect(crons).toEqual(['*/10 * * * *', '*/30 * * * *', '45 2 * * *']);
  });

  it('rejects out-of-range interval values', () => {
    expect(() =>
      buildEnvCronSet({
        jobsIntervalMinutes: 0,
        pollIntervalMinutes: 30,
        existingCrons: []
      })
    ).toThrow('jobs interval must be between 1 and 30 minutes.');

    expect(() =>
      buildEnvCronSet({
        jobsIntervalMinutes: 5,
        pollIntervalMinutes: 2,
        existingCrons: []
      })
    ).toThrow('poll interval must be between 5 and 60 minutes.');
  });

  it('updates env trigger crons in wrangler config text', () => {
    const source = `name = "test"\n\n[env.production]\nname = "x"\n\n[env.production.triggers]\ncrons = ["*/5 * * * *", "0 * * * *", "30 3 * * *"]\n`;
    const updated = updateEnvTriggerCrons(source, 'production', ['*/6 * * * *', '0 * * * *', '30 3 * * *']);
    const parsed = extractEnvCrons(updated, 'production');
    expect(parsed).toEqual(['*/6 * * * *', '0 * * * *', '30 3 * * *']);
  });
});
