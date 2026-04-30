/**
 * Image generation helpers for the fallback image pool.
 *
 * Two providers are supported:
 *   - OpenAI gpt-image-1  (returns base64-encoded JPEG)
 *   - Google Imagen 3     (returns base64-encoded PNG; we accept as-is but
 *                          callers label the MIME type accordingly)
 *
 * Both functions hard-cap at 60 s and surface provider error messages in the
 * thrown error so the admin UI can display them clearly.
 */

export interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: 'image/jpeg' | 'image/png';
}

// ---------------------------------------------------------------------------
// OpenAI gpt-image-1
// ---------------------------------------------------------------------------

export async function generateOpenAIImage(
  prompt: string,
  apiKey: string,
): Promise<GeneratedImage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        size: '1024x1024',
        n: 1,
        output_format: 'jpeg',
        quality: 'standard',
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    let msg = `OpenAI error ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) msg = `OpenAI: ${body.error.message}`;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const body = (await res.json()) as {
    data?: Array<{ b64_json?: string }>;
  };
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI: no image data in response');

  return { bytes: base64ToBytes(b64), mimeType: 'image/jpeg' };
}

// ---------------------------------------------------------------------------
// Google Imagen 3
// ---------------------------------------------------------------------------

export async function generateImagen3(
  prompt: string,
  apiKey: string,
): Promise<GeneratedImage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `imagen-3.0-generate-002:predict?key=${encodeURIComponent(apiKey)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '1:1',
        },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    let msg = `Imagen3 error ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) msg = `Imagen3: ${body.error.message}`;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const body = (await res.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
  };
  const prediction = body.predictions?.[0];
  const b64 = prediction?.bytesBase64Encoded;
  if (!b64) throw new Error('Imagen3: no image data in response');

  // Imagen 3 returns PNG by default; honour the declared mimeType if present.
  const mimeType: 'image/jpeg' | 'image/png' =
    prediction?.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';

  return { bytes: base64ToBytes(b64), mimeType };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
