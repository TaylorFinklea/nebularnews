import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDER_INNER_CALL = /\$\$render_inner\s*\(/;
const RENDER_INNER_DEF = /(?:function\s+\$\$render_inner\s*\(|const\s+\$\$render_inner\s*=)/;
const RENDER_INNER_IIFE = /\(function\s+\$\$render_inner\s*\(/;

export function inspectFileContent(content) {
  const findings = [];

  if (RENDER_INNER_IIFE.test(content)) {
    findings.push({
      code: 'render-inner-iife',
      message: 'Found suspicious `(function $$render_inner(` pattern in SSR output.'
    });
  }

  if (RENDER_INNER_CALL.test(content) && !RENDER_INNER_DEF.test(content)) {
    findings.push({
      code: 'render-inner-missing-def',
      message: 'Found `$$render_inner(...)` call without a matching function/const definition in file.'
    });
  }

  return findings;
}

async function collectJsFiles(rootDir) {
  const files = [];

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && fullPath.endsWith('.js')) {
        files.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return files;
}

export async function scanSsrOutput(rootDir) {
  const files = await collectJsFiles(rootDir);
  const issues = [];

  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    const findings = inspectFileContent(content);
    for (const finding of findings) {
      issues.push({ filePath, ...finding });
    }
  }

  return { filesScanned: files.length, issues };
}

function formatIssue(issue, rootDir) {
  const relativePath = path.relative(rootDir, issue.filePath) || issue.filePath;
  return `- ${relativePath}: ${issue.message} [${issue.code}]`;
}

async function main() {
  const rootDir = path.resolve(process.cwd(), '.svelte-kit/output/server');

  let stats;
  try {
    stats = await fs.stat(rootDir);
  } catch {
    console.error(`SSR output path not found: ${rootDir}. Run \`vite build\` first.`);
    process.exit(1);
  }

  if (!stats.isDirectory()) {
    console.error(`SSR output path is not a directory: ${rootDir}`);
    process.exit(1);
  }

  const { filesScanned, issues } = await scanSsrOutput(rootDir);

  if (issues.length > 0) {
    console.error(`SSR render guard failed with ${issues.length} issue(s) across ${filesScanned} files:`);
    for (const issue of issues) {
      console.error(formatIssue(issue, rootDir));
    }
    process.exit(1);
  }

  console.log(`SSR render guard passed (${filesScanned} files scanned).`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const thisFilePath = fileURLToPath(import.meta.url);

if (invokedPath && thisFilePath === invokedPath) {
  await main();
}
