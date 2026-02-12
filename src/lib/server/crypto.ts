const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export async function importAesKey(secretBase64: string) {
  const raw = fromBase64(secretBase64);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptString(plaintext: string, secretBase64: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(secretBase64);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(plaintext));
  return `${toBase64(iv)}:${toBase64(new Uint8Array(cipher))}`;
}

export async function decryptString(payload: string, secretBase64: string) {
  const [ivB64, dataB64] = payload.split(':');
  if (!ivB64 || !dataB64) throw new Error('Invalid encrypted payload');
  const iv = fromBase64(ivB64);
  const data = fromBase64(dataB64);
  const key = await importAesKey(secretBase64);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return textDecoder.decode(plaintext);
}

export async function hmacSign(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(message));
  return toBase64(new Uint8Array(signature));
}

export async function hmacVerify(message: string, signatureB64: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const signature = fromBase64(signatureB64);
  return crypto.subtle.verify('HMAC', key, signature, textEncoder.encode(message));
}

export async function pbkdf2Verify(password: string, hash: string) {
  const parts = hash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = fromBase64(parts[2]);
  const expected = fromBase64(parts[3]);
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(password), { name: 'PBKDF2' }, false, [
    'deriveBits'
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    expected.length * 8
  );
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
