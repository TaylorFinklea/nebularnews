import { describe, expect, it } from 'vitest';
import { constantTimeEquals, isMcpBearerTokenValid, parseBearerToken } from './auth';

describe('mcp auth helpers', () => {
  it('parses bearer token from authorization header', () => {
    expect(parseBearerToken('Bearer abc123')).toBe('abc123');
    expect(parseBearerToken('bearer token-with-space')).toBe('token-with-space');
  });

  it('returns null for non-bearer or missing tokens', () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken('Basic xyz')).toBeNull();
    expect(parseBearerToken('Bearer')).toBeNull();
  });

  it('compares strings with constant-time style equality', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
    expect(constantTimeEquals('abc', 'ab')).toBe(false);
  });

  it('validates provided bearer token against expected token', () => {
    expect(isMcpBearerTokenValid('secret-token', 'secret-token')).toBe(true);
    expect(isMcpBearerTokenValid('secret-token', 'different-token')).toBe(false);
    expect(isMcpBearerTokenValid(null, 'secret-token')).toBe(false);
    expect(isMcpBearerTokenValid('secret-token', undefined)).toBe(false);
  });
});

