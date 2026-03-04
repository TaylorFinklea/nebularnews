const textEncoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

export const createOpaqueToken = (byteLength = 32) => {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return toBase64Url(bytes);
};

export const sha256Base64Url = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
};

export const verifyPkceS256 = async (codeVerifier: string, expectedChallenge: string) => {
  const actual = await sha256Base64Url(codeVerifier);
  return actual === expectedChallenge;
};
