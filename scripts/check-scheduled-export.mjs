import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workerPath = resolve('.svelte-kit/cloudflare/_worker.js');
const source = await readFile(workerPath, 'utf8');

const hasScheduledExport =
  source.includes('kitScheduled as scheduled') ||
  source.includes('hooks.server.js";\nexport {\n  worker_default as default,\n  scheduled') ||
  source.includes(' as scheduled');

if (!hasScheduledExport) {
  console.error(
    'Missing scheduled handler export in .svelte-kit/cloudflare/_worker.js. Cron triggers will not run.'
  );
  process.exit(1);
}

console.log('Verified scheduled handler export in Cloudflare worker bundle.');
