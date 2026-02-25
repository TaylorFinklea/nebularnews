#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_RETENTION_CRON = '30 3 * * *';
const DAILY_CRON_PATTERN = /^\d{1,2}\s+\d{1,2}\s+\*\s+\*\s+\*$/;

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const parseArgs = (argv) => {
  const args = {
    env: null,
    jobsInterval: null,
    pollInterval: null,
    file: 'wrangler.toml',
    dryRun: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--env') {
      args.env = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === '--jobs-interval') {
      args.jobsInterval = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--poll-interval') {
      args.pollInterval = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--file') {
      args.file = argv[i + 1] ?? args.file;
      i += 1;
      continue;
    }
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      console.log(
        'Usage: node scripts/apply-scheduler-cron.mjs --env production|staging --jobs-interval <minutes> --poll-interval <minutes> [--file wrangler.toml] [--dry-run]'
      );
      process.exit(0);
    }
    fail(`Unknown option: ${token}`);
  }

  return args;
};

const clampInterval = (name, value, min, max) => {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number.`);
  }
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) {
    throw new Error(`${name} must be between ${min} and ${max} minutes.`);
  }
  return rounded;
};

export const intervalMinutesToCronExpression = (minutes) => {
  if (minutes >= 60) return '0 * * * *';
  return `*/${minutes} * * * *`;
};

export const parseCronArray = (raw) => {
  const values = [];
  const re = /"([^"]+)"/g;
  let match = re.exec(raw);
  while (match) {
    values.push(match[1]);
    match = re.exec(raw);
  }
  return values;
};

export const renderCronArray = (crons) => `[${crons.map((cron) => `"${cron}"`).join(', ')}]`;

const unique = (items) => {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      output.push(item);
    }
  }
  return output;
};

const pickRetentionCron = (existingCrons) =>
  existingCrons.find((cron) => DAILY_CRON_PATTERN.test(cron) && cron !== '0 * * * *') ?? DEFAULT_RETENTION_CRON;

export const buildEnvCronSet = ({ jobsIntervalMinutes, pollIntervalMinutes, existingCrons }) => {
  const jobsCron = intervalMinutesToCronExpression(clampInterval('jobs interval', jobsIntervalMinutes, 1, 30));
  const pollCron = intervalMinutesToCronExpression(clampInterval('poll interval', pollIntervalMinutes, 5, 60));
  const retentionCron = pickRetentionCron(existingCrons ?? []);
  return unique([jobsCron, pollCron, retentionCron]);
};

export const extractEnvCrons = (toml, env) => {
  const blockPattern = new RegExp(`\\[env\\.${env}\\.triggers\\]\\s*\\n\\s*crons\\s*=\\s*\\[(.*?)\\]`, 'm');
  const match = toml.match(blockPattern);
  if (!match) return [];
  return parseCronArray(match[1]);
};

export const updateEnvTriggerCrons = (toml, env, crons) => {
  const blockPattern = new RegExp(`(\\[env\\.${env}\\.triggers\\]\\s*\\n)\\s*crons\\s*=\\s*\\[(.*?)\\]`, 'm');
  const replacement = `$1crons = ${renderCronArray(crons)}`;
  if (blockPattern.test(toml)) {
    return toml.replace(blockPattern, replacement);
  }

  const envHeader = `[env.${env}]`;
  const envIndex = toml.indexOf(envHeader);
  if (envIndex < 0) {
    throw new Error(`Could not find section ${envHeader} in wrangler.toml`);
  }

  const insertAt = toml.indexOf('\n', envIndex);
  if (insertAt < 0) {
    throw new Error(`Malformed ${envHeader} section in wrangler.toml`);
  }

  const insertion = `\n[env.${env}.triggers]\ncrons = ${renderCronArray(crons)}\n`;
  return `${toml.slice(0, insertAt + 1)}${insertion}${toml.slice(insertAt + 1)}`;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.env !== 'production' && args.env !== 'staging') {
    fail('--env must be either production or staging.');
  }
  if (args.jobsInterval === null || args.pollInterval === null) {
    fail('Both --jobs-interval and --poll-interval are required.');
  }

  const targetFile = resolve(process.cwd(), args.file);
  const source = readFileSync(targetFile, 'utf8');
  const existingCrons = extractEnvCrons(source, args.env);
  const nextCrons = buildEnvCronSet({
    jobsIntervalMinutes: args.jobsInterval,
    pollIntervalMinutes: args.pollInterval,
    existingCrons
  });

  const nextToml = updateEnvTriggerCrons(source, args.env, nextCrons);
  if (!args.dryRun) {
    writeFileSync(targetFile, nextToml);
  }

  const deployCmd = args.env === 'production' ? 'npm run deploy:prod' : 'npm run deploy:staging';

  console.log(`${args.dryRun ? 'Would update' : 'Updated'} ${args.file} for env.${args.env} triggers.`);
  console.log(`Cron set: ${nextCrons.join(', ')}`);
  console.log(`Next: ${deployCmd}`);
};

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  try {
    main();
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Failed to apply scheduler cron settings.');
  }
}
