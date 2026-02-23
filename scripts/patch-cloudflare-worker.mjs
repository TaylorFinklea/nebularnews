import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workerPath = resolve('.svelte-kit/cloudflare/_worker.js');
const scheduledImport = 'import { scheduled as kitScheduled } from "./../output/server/chunks/hooks.server.js";';

const source = await readFile(workerPath, 'utf8');

if (source.includes('scheduled: kitScheduled')) {
  console.log('Cloudflare worker already patched for scheduled handler.');
  process.exit(0);
}

if (!source.includes('import { env } from "cloudflare:workers";')) {
  throw new Error('Unable to find cloudflare env import to inject scheduled import.');
}

const withImport = source.includes(scheduledImport)
  ? source
  : source.replace(
      'import { env } from "cloudflare:workers";',
      `import { env } from "cloudflare:workers";\n${scheduledImport}`
    );

const objectFooter = `\n  }\n};\nexport {\n  worker_default as default`;
if (!withImport.includes(objectFooter)) {
  throw new Error('Unable to find worker_default object footer to patch scheduled handler.');
}

const withScheduledOnDefault = withImport.replace(
  objectFooter,
  `\n  },\n  scheduled: kitScheduled\n};\nexport {\n  worker_default as default`
);

const exportFooter = `export {\n  worker_default as default\n};`;
const patched = withScheduledOnDefault.includes(exportFooter)
  ? withScheduledOnDefault.replace(
      exportFooter,
      `export {\n  worker_default as default,\n  kitScheduled as scheduled\n};`
    )
  : withScheduledOnDefault;
await writeFile(workerPath, patched, 'utf8');

console.log('Patched .svelte-kit/cloudflare/_worker.js with scheduled handler export.');
