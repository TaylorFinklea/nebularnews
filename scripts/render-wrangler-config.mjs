import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const args = process.argv.slice(2);
const getArgValue = (name, fallback = '') => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
};

const templatePath = path.resolve(root, getArgValue('--template', 'wrangler.toml'));
const outputPath = path.resolve(root, getArgValue('--output', 'wrangler.generated.toml'));

const readEnv = (key, fallback = '') => process.env[key]?.trim() || fallback;

const replacements = {
  __DEV_D1_DATABASE_NAME__: readEnv('DEV_D1_DATABASE_NAME', 'nebular-news-dev'),
  __STAGING_D1_DATABASE_NAME__: readEnv('STAGING_D1_DATABASE_NAME', 'nebular-news-staging'),
  __STAGING_D1_DATABASE_ID__: readEnv('STAGING_D1_DATABASE_ID', '00000000-0000-0000-0000-000000000000'),
  __PRODUCTION_D1_DATABASE_NAME__: readEnv('PRODUCTION_D1_DATABASE_NAME', 'nebular-news-production'),
  __PRODUCTION_D1_DATABASE_ID__: readEnv('PRODUCTION_D1_DATABASE_ID', '00000000-0000-0000-0000-000000000000'),
  __PRODUCTION_MCP_ALLOWED_ORIGINS__: readEnv('PRODUCTION_MCP_ALLOWED_ORIGINS', ''),
  __PRODUCTION_MCP_BASE_URL__: readEnv('PRODUCTION_MCP_BASE_URL', ''),
  __PRODUCTION_MOBILE_BASE_URL__: readEnv('PRODUCTION_MOBILE_BASE_URL', ''),
  __PRODUCTION_MOBILE_ALLOWED_ORIGINS__: readEnv('PRODUCTION_MOBILE_ALLOWED_ORIGINS', ''),
  __PRODUCTION_MOBILE_OAUTH_CLIENT_ID__: readEnv('PRODUCTION_MOBILE_OAUTH_CLIENT_ID', 'nebular-news-ios'),
  __PRODUCTION_MOBILE_OAUTH_CLIENT_NAME__: readEnv('PRODUCTION_MOBILE_OAUTH_CLIENT_NAME', 'Nebular News iOS'),
  __PRODUCTION_MOBILE_OAUTH_REDIRECT_URIS__: readEnv(
    'PRODUCTION_MOBILE_OAUTH_REDIRECT_URIS',
    'nebularnews://oauth/callback'
  )
};

let rendered = fs.readFileSync(templatePath, 'utf8');
for (const [token, value] of Object.entries(replacements)) {
  rendered = rendered.replaceAll(token, value);
}

fs.writeFileSync(outputPath, rendered);
console.log(`Rendered ${path.relative(root, outputPath)} from ${path.relative(root, templatePath)}`);
