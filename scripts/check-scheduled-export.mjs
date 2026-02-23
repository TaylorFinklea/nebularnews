import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workerPath = resolve('.svelte-kit/cloudflare/_worker.js');
const source = await readFile(workerPath, 'utf8');

const hasScheduledHandlerOnDefault =
  source.includes('scheduled: kitScheduled') ||
  source.includes('scheduled: scheduled');

const hasScheduledNamedExport = source.includes('as scheduled');

if (!hasScheduledHandlerOnDefault) {
  console.error(
    'Missing scheduled handler on worker default export in .svelte-kit/cloudflare/_worker.js. Cron triggers will not run.'
  );
  process.exit(1);
}

if (!hasScheduledNamedExport) {
  console.warn(
    'Scheduled handler is wired on default export but no named scheduled export was found (this is acceptable).'
  );
}

console.log('Verified scheduled handler wiring in Cloudflare worker bundle.');
