import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const appHtmlPath = resolve('src/app.html');
const source = await readFile(appHtmlPath, 'utf8');

if (/data-sveltekit-reload(\s|>|=)/.test(source)) {
  console.error(
    'Forbidden global data-sveltekit-reload found in src/app.html. Remove hard reload fallback before deploy.'
  );
  process.exit(1);
}

console.log('Verified src/app.html does not contain global data-sveltekit-reload.');
