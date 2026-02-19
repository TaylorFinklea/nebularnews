import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { pbkdf2Verify } from './crypto';

const createHash = (password: string, iterations = 1000) => {
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return `pbkdf2$${iterations}$${salt.toString('base64')}$${digest.toString('base64')}`;
};

describe('pbkdf2Verify', () => {
  it('returns true for valid password/hash pair', async () => {
    const hash = createHash('s3cret');
    await expect(pbkdf2Verify('s3cret', hash)).resolves.toBe(true);
  });

  it('returns false for malformed hash values without throwing', async () => {
    await expect(pbkdf2Verify('s3cret', 'not-a-hash')).resolves.toBe(false);
    await expect(pbkdf2Verify('s3cret', 'pbkdf2$1000$%%%$%%%')).resolves.toBe(false);
  });

  it('returns false when deriveBits throws an unsupported-iterations error', async () => {
    const hash = createHash('s3cret');
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, 'deriveBits').mockRejectedValueOnce(
      new Error('Pbkdf2 failed: iteration counts above 100000 are not supported (requested 210000).')
    );

    await expect(pbkdf2Verify('s3cret', hash)).resolves.toBe(false);
    deriveBits.mockRestore();
  });
});
