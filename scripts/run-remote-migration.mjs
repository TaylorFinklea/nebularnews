import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);

const readArg = (name, fallback = '') => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
};

const targetEnv = readArg('--env');
if (!targetEnv) {
  console.error('Missing required flag: --env <staging|production>');
  process.exit(1);
}

const configPath = path.resolve(root, process.env.WRANGLER_CONFIG_PATH || 'wrangler.toml');
const schemaPath = path.resolve(root, readArg('--file', 'schema.sql'));
const source = fs.readFileSync(configPath, 'utf8');

const sectionPrefix = targetEnv === 'production' ? '[env.production]' : `[env.${targetEnv}]`;
const sectionPattern = new RegExp(`${sectionPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?\\[\\[env\\.${targetEnv}\\.d1_databases\\]\\][\\s\\S]*?database_name = "([^"]+)"`);
const sectionMatch = source.match(sectionPattern);
const dbName =
  sectionMatch?.[1] ||
  source.match(/\[\[d1_databases\]\][\s\S]*?database_name = "([^"]+)"/)?.[1];

if (!dbName) {
  console.error(`Unable to resolve database_name for env "${targetEnv}" from ${configPath}`);
  process.exit(1);
}

const command = [
  'd1',
  'execute',
  dbName,
  '--remote',
  '--env',
  targetEnv,
  '--config',
  configPath,
  '--file',
  schemaPath
];

const result = spawnSync('npx', ['wrangler', ...command], {
  stdio: 'inherit',
  cwd: root,
  env: process.env
});

process.exit(result.status ?? 1);
