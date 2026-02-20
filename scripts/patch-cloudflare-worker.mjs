import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workerPath = resolve('.svelte-kit/cloudflare/_worker.js');
const scheduledImport = 'import { scheduled as kitScheduled } from "./../output/server/chunks/hooks.server.js";';
const exportBlock = `export {\n  worker_default as default\n};`;
const patchedExportBlock = `export {\n  worker_default as default,\n  kitScheduled as scheduled\n};`;

const source = await readFile(workerPath, 'utf8');

if (source.includes('kitScheduled as scheduled')) {
  console.log('Cloudflare worker already patched for scheduled handler.');
  process.exit(0);
}

if (!source.includes(exportBlock)) {
  throw new Error('Unable to find worker default export block to patch.');
}

if (!source.includes('import { env } from "cloudflare:workers";')) {
  throw new Error('Unable to find cloudflare env import to inject scheduled import.');
}

const withImport = source.replace(
  'import { env } from "cloudflare:workers";',
  `import { env } from "cloudflare:workers";\n${scheduledImport}`
);

const patched = withImport.replace(exportBlock, patchedExportBlock);
await writeFile(workerPath, patched, 'utf8');

console.log('Patched .svelte-kit/cloudflare/_worker.js with scheduled handler export.');
