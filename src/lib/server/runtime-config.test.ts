import { describe, expect, it } from 'vitest';
import { inspectRuntimeConfig } from './runtime-config';

const createEnv = (overrides: Partial<App.Platform['env']> = {}): App.Platform['env'] =>
  ({
    ADMIN_PASSWORD_HASH: 'pbkdf2$100000$AQIDBA==$BQYHCAk=',
    SESSION_SECRET: 'test-session-secret-with-minimum-length-123456',
    ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    MCP_BEARER_TOKEN: 'token',
    MCP_PUBLIC_ENABLED: 'false',
    MCP_PUBLIC_BASE_URL: '',
    MCP_PUBLIC_ALLOWED_ORIGINS: '',
    APP_ENV: 'production',
    ...overrides
  }) as App.Platform['env'];

describe('inspectRuntimeConfig', () => {
  it('accepts a parse-valid pbkdf2 hash in production', () => {
    const report = inspectRuntimeConfig(createEnv());
    expect(report.ok).toBe(true);
    expect(report.secretChecks.adminPasswordHash).toBe(true);
  });

  it('rejects pbkdf2 iteration values beyond cloudflare support', () => {
    const report = inspectRuntimeConfig(
      createEnv({
        ADMIN_PASSWORD_HASH: 'pbkdf2$210000$AQIDBA==$BQYHCAk='
      })
    );
    expect(report.ok).toBe(false);
    expect(report.errors.join(' ')).toContain('ADMIN_PASSWORD_HASH');
  });

  it('rejects pbkdf2 hashes with invalid base64 salt/hash', () => {
    const report = inspectRuntimeConfig(
      createEnv({
        ADMIN_PASSWORD_HASH: 'pbkdf2$100000$%%%$%%%=='
      })
    );
    expect(report.ok).toBe(false);
    expect(report.errors.join(' ')).toContain('valid base64');
  });

  it('requires HTTPS public MCP config when public mode is enabled', () => {
    const report = inspectRuntimeConfig(
      createEnv({
        MCP_PUBLIC_ENABLED: 'true',
        MCP_PUBLIC_BASE_URL: 'http://mcp.example.com',
        MCP_PUBLIC_ALLOWED_ORIGINS: 'https://chatgpt.com'
      })
    );

    expect(report.ok).toBe(false);
    expect(report.errors.join(' ')).toContain('MCP_PUBLIC_BASE_URL');
  });

  it('accepts valid public MCP config when enabled', () => {
    const report = inspectRuntimeConfig(
      createEnv({
        MCP_PUBLIC_ENABLED: 'true',
        MCP_PUBLIC_BASE_URL: 'https://mcp.example.com',
        MCP_PUBLIC_ALLOWED_ORIGINS: 'https://chatgpt.com,https://chat.openai.com'
      })
    );

    expect(report.ok).toBe(true);
    expect(report.secretChecks.mcpPublicConfig).toBe(true);
  });
});
