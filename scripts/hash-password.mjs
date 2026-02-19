import { webcrypto as crypto } from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-password -- "your password"');
  process.exit(1);
}

const iterations = 100000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const enc = new TextEncoder();

const key = await crypto.subtle.importKey(
  'raw',
  enc.encode(password),
  { name: 'PBKDF2' },
  false,
  ['deriveBits']
);

const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
  key,
  256
);

const hash = new Uint8Array(bits);

const toB64 = (u8) => Buffer.from(u8).toString('base64');
const result = `pbkdf2$${iterations}$${toB64(salt)}$${toB64(hash)}`;
console.log(result);
