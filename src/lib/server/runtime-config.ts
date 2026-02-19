type RuntimeStage = 'development' | 'staging' | 'production';

type SecretChecks = {
  adminPasswordHash: boolean;
  sessionSecret: boolean;
  encryptionKey: boolean;
  mcpBearerToken: boolean;
};

export type RuntimeConfigReport = {
  stage: RuntimeStage;
  ok: boolean;
  errors: string[];
  warnings: string[];
  secretChecks: SecretChecks;
};

const MIN_SESSION_SECRET_LEN = 32;
const ENCRYPTION_KEY_BYTES = 32;
const PBKDF2_MIN_ITERATIONS = 1;
const PBKDF2_MAX_ITERATIONS = 100000;

let cachedReport: RuntimeConfigReport | null = null;
let cacheKey = '';

const trim = (value: string | undefined) => value?.trim() ?? '';

const detectStage = (env: App.Platform['env']): RuntimeStage => {
  const raw = trim(env.APP_ENV).toLowerCase();
  if (raw === 'production') return 'production';
  if (raw === 'staging') return 'staging';
  return 'development';
};

const decodeBase64 = (value: string) => {
  if (typeof atob === 'function') {
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  }
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(value, 'base64'));
  }
  throw new Error('No base64 decoder available');
};

const isValidPbkdf2Hash = (value: string) => {
  const parts = value.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations)) return false;
  if (iterations < PBKDF2_MIN_ITERATIONS || iterations > PBKDF2_MAX_ITERATIONS) return false;
  try {
    const salt = decodeBase64(parts[2]);
    const hash = decodeBase64(parts[3]);
    return salt.length > 0 && hash.length > 0;
  } catch {
    return false;
  }
};

const buildCacheKey = (env: App.Platform['env']) =>
  JSON.stringify({
    appEnv: trim(env.APP_ENV),
    adminPasswordHash: trim(env.ADMIN_PASSWORD_HASH),
    sessionSecret: trim(env.SESSION_SECRET),
    encryptionKey: trim(env.ENCRYPTION_KEY),
    mcpToken: trim(env.MCP_BEARER_TOKEN)
  });

export const inspectRuntimeConfig = (env: App.Platform['env']): RuntimeConfigReport => {
  const key = buildCacheKey(env);
  if (cachedReport && cacheKey === key) return cachedReport;

  const stage = detectStage(env);
  const errors: string[] = [];
  const warnings: string[] = [];

  const adminPasswordHash = trim(env.ADMIN_PASSWORD_HASH);
  const sessionSecret = trim(env.SESSION_SECRET);
  const encryptionKey = trim(env.ENCRYPTION_KEY);
  const mcpBearerToken = trim(env.MCP_BEARER_TOKEN);

  const secretChecks: SecretChecks = {
    adminPasswordHash: false,
    sessionSecret: false,
    encryptionKey: false,
    mcpBearerToken: false
  };

  if (adminPasswordHash && isValidPbkdf2Hash(adminPasswordHash)) {
    secretChecks.adminPasswordHash = true;
  } else {
    errors.push(
      `ADMIN_PASSWORD_HASH is missing or invalid (expected pbkdf2$iterations$salt$hash, iterations ${PBKDF2_MIN_ITERATIONS}-${PBKDF2_MAX_ITERATIONS}, valid base64 salt/hash).`
    );
  }

  if (sessionSecret.length >= MIN_SESSION_SECRET_LEN) {
    secretChecks.sessionSecret = true;
  } else {
    errors.push(`SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LEN} characters.`);
  }

  try {
    const bytes = decodeBase64(encryptionKey);
    if (bytes.length !== ENCRYPTION_KEY_BYTES) {
      errors.push(`ENCRYPTION_KEY must decode to ${ENCRYPTION_KEY_BYTES} bytes (base64).`);
    } else {
      secretChecks.encryptionKey = true;
    }
  } catch {
    errors.push(`ENCRYPTION_KEY must decode to ${ENCRYPTION_KEY_BYTES} bytes (base64).`);
  }

  if (mcpBearerToken.length > 0) {
    secretChecks.mcpBearerToken = true;
  } else if (stage === 'production') {
    errors.push('MCP_BEARER_TOKEN is required in production.');
  } else {
    warnings.push('MCP_BEARER_TOKEN is not configured; MCP endpoint will reject bearer auth.');
  }

  cachedReport = {
    stage,
    ok: errors.length === 0,
    errors,
    warnings,
    secretChecks
  };
  cacheKey = key;
  return cachedReport;
};

export const assertRuntimeConfig = (env: App.Platform['env']) => {
  const report = inspectRuntimeConfig(env);
  if (report.stage === 'production' && !report.ok) {
    throw new Error(`Invalid runtime configuration: ${report.errors.join(' ')}`);
  }
  return report;
};
