import PostalMime from 'postal-mime';

// MIME parser wrapper. Pure function: takes a raw email stream, returns the
// structured fields the email handler needs. No DB, no global state. Uses
// postal-mime (already in deps), which is Workers-compatible. If the lib
// ever rejects Workers, swap to mailparser or letter-opener here — the
// callers only depend on the ParsedEmail shape.

export interface ParsedEmail {
  from: string;             // "Display Name <addr@example.com>" or just "addr@example.com"
  fromAddress: string;      // "addr@example.com" — lowercased, used for TOFU comparison
  subject: string;
  messageId: string | null; // unwrapped (no angle brackets)
  listId: string | null;    // List-Id header value, raw
  htmlBody: string | null;
  textBody: string | null;
  archiveUrl: string | null; // "View in browser"/"View on web" link if found in HTML
}

const ARCHIVE_LINK_RE = /<a[^>]*\bhref="(https?:\/\/[^"]+)"[^>]*>[^<]*(?:view\s+(?:in|on)\s+(?:browser|web)|view\s+online|read\s+in\s+browser)[^<]*<\/a>/i;

function extractArchiveUrl(html: string | null): string | null {
  if (!html) return null;
  const m = html.match(ARCHIVE_LINK_RE);
  return m ? m[1] : null;
}

export async function parseEmail(raw: ReadableStream | ArrayBuffer | Uint8Array | string): Promise<ParsedEmail> {
  const parser = new PostalMime();
  const email = await parser.parse(raw as Parameters<typeof parser.parse>[0]);

  const fromName = email.from?.name ?? '';
  const fromAddrRaw = email.from?.address ?? '';
  const fromAddress = fromAddrRaw.trim().toLowerCase();
  const fromDisplay = fromName ? `${fromName} <${fromAddrRaw}>` : fromAddrRaw;

  // postal-mime exposes messageId with angle brackets sometimes; strip them.
  const messageIdRaw = email.messageId ?? null;
  const messageId = messageIdRaw ? messageIdRaw.replace(/^<|>$/g, '') : null;

  const listIdHeader = email.headers?.find((h) => h.key.toLowerCase() === 'list-id')?.value ?? null;

  const htmlBody = email.html ?? null;
  const textBody = email.text ?? null;

  return {
    from: fromDisplay,
    fromAddress,
    subject: email.subject ?? '',
    messageId,
    listId: listIdHeader,
    htmlBody,
    textBody,
    archiveUrl: extractArchiveUrl(htmlBody),
  };
}
