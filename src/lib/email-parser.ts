import PostalMime from 'postal-mime';

export interface ParsedEmail {
  from: { name: string | null; address: string };
  subject: string;
  date: Date | null;
  messageId: string;
  html: string | null;
  text: string | null;
  listUnsubscribe: string | null;
}

/**
 * Parse a raw MIME email into structured content.
 * Uses postal-mime which is designed for Workers/browser environments.
 */
export async function parseEmail(raw: ReadableStream<Uint8Array> | ArrayBuffer | string): Promise<ParsedEmail> {
  let rawData: ArrayBuffer;

  if (raw instanceof ReadableStream) {
    // Read the stream into an ArrayBuffer (cap at 5MB).
    const reader = raw.getReader();
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    const MAX_SIZE = 5 * 1024 * 1024;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.byteLength;
      if (totalSize > MAX_SIZE) break;
      chunks.push(value);
    }

    const result = new Uint8Array(totalSize > MAX_SIZE ? MAX_SIZE : totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      const toCopy = Math.min(chunk.byteLength, result.byteLength - offset);
      result.set(chunk.subarray(0, toCopy), offset);
      offset += toCopy;
    }
    rawData = result.buffer as ArrayBuffer;
  } else if (typeof raw === 'string') {
    rawData = new TextEncoder().encode(raw).buffer as ArrayBuffer;
  } else {
    rawData = raw;
  }

  const parser = new PostalMime();
  const parsed = await parser.parse(rawData);

  // Extract from address.
  const fromAddr = parsed.from?.address ?? 'unknown@unknown.com';
  const fromName = parsed.from?.name ?? null;

  // Generate a fallback Message-ID if not present.
  const messageId = parsed.messageId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}@nebularnews.local`;

  // Extract List-Unsubscribe header.
  const listUnsubscribe = parsed.headers?.find(
    h => h.key.toLowerCase() === 'list-unsubscribe',
  )?.value ?? null;

  return {
    from: { name: fromName, address: fromAddr },
    subject: parsed.subject ?? '(No subject)',
    date: parsed.date ? new Date(parsed.date) : null,
    messageId,
    html: parsed.html ?? null,
    text: parsed.text ?? null,
    listUnsubscribe,
  };
}
