import { spawnSync } from 'node:child_process';

const patterns = [
  'news\\.finklea\\.dev',
  'mcp\\.news\\.finklea\\.dev',
  'api\\.news\\.finklea\\.dev',
  '/Users/tfinklea',
  'f3adc274-12cf-4024-981e-7abe19366191'
];

const trackedFiles = spawnSync('git', ['ls-files', '-s', '-z'], { encoding: 'utf8' });
if (trackedFiles.status !== 0) {
  console.error(trackedFiles.stderr.trim() || 'Failed to list tracked files.');
  process.exit(trackedFiles.status ?? 1);
}

const regularFiles = trackedFiles.stdout
  .split('\0')
  .filter(Boolean)
  .flatMap((entry) => {
    const match = entry.match(/^(\d+)\s+[0-9a-f]+\s+\d+\t(.+)$/);
    if (!match) return [];
    const [, mode, filePath] = match;
    return mode === '160000' ? [] : [filePath];
  });

if (regularFiles.length === 0) {
  console.log('No tracked regular files found to scan.');
  process.exit(0);
}

const result = spawnSync(
  'rg',
  ['-n', ...patterns.flatMap((pattern) => ['-e', pattern]), '--', ...regularFiles],
  { encoding: 'utf8' }
);

if (result.status === 0) {
  console.error('Found tracked first-party deployment values that should not be committed:\n');
  console.error(result.stdout.trim());
  process.exit(1);
}

if (result.status && result.status > 1) {
  console.error(result.stderr.trim() || 'Failed to scan tracked files for first-party config.');
  process.exit(result.status);
}

console.log('No tracked first-party deployment values found.');
