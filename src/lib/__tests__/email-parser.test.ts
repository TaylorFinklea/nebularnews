import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseEmail } from '../email-parser';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function fixtureStream(name: string): ReadableStream {
  const buf = readFileSync(join(fixturesDir, name));
  return new Response(buf).body!;
}

describe('parseEmail — Substack-shaped newsletter', () => {
  it('extracts From: display name and address', async () => {
    const parsed = await parseEmail(fixtureStream('substack-newsletter.eml'));
    expect(parsed.from).toContain('Stratechery');
    expect(parsed.fromAddress).toBe('ben@stratechery.com');
  });

  it('extracts Subject', async () => {
    const parsed = await parseEmail(fixtureStream('substack-newsletter.eml'));
    expect(parsed.subject).toBe('The aggregator paradox revisited');
  });

  it('extracts Message-ID', async () => {
    const parsed = await parseEmail(fixtureStream('substack-newsletter.eml'));
    expect(parsed.messageId).toBe('stratechery-test-001@email.stratechery.com');
  });

  it('extracts List-ID', async () => {
    const parsed = await parseEmail(fixtureStream('substack-newsletter.eml'));
    expect(parsed.listId).toContain('stratechery.email.stratechery.com');
  });

  it('extracts HTML body', async () => {
    const parsed = await parseEmail(fixtureStream('substack-newsletter.eml'));
    expect(parsed.htmlBody).toContain('Aggregator Paradox');
  });

  it('extracts plain-text body', async () => {
    const parsed = await parseEmail(fixtureStream('substack-newsletter.eml'));
    expect(parsed.textBody).toContain('aggregator paradox');
  });

  it('extracts archive URL from HTML "View in browser" link', async () => {
    const parsed = await parseEmail(fixtureStream('substack-newsletter.eml'));
    expect(parsed.archiveUrl).toBe('https://stratechery.com/2026/aggregator-paradox-revisited');
  });
});

describe('parseEmail — plain-text-only newsletter', () => {
  it('extracts From: and Subject', async () => {
    const parsed = await parseEmail(fixtureStream('plain-text-newsletter.eml'));
    expect(parsed.fromAddress).toBe('plain@example.com');
    expect(parsed.subject).toBe('Plain text only newsletter');
  });

  it('htmlBody is null when no HTML part', async () => {
    const parsed = await parseEmail(fixtureStream('plain-text-newsletter.eml'));
    expect(parsed.htmlBody).toBeNull();
  });

  it('textBody is populated', async () => {
    const parsed = await parseEmail(fixtureStream('plain-text-newsletter.eml'));
    expect(parsed.textBody).toContain('no HTML part');
  });

  it('archiveUrl is null when no link found', async () => {
    const parsed = await parseEmail(fixtureStream('plain-text-newsletter.eml'));
    expect(parsed.archiveUrl).toBeNull();
  });
});

describe('parseEmail — defensive', () => {
  it('normalizes fromAddress to lowercase', async () => {
    const parsed = await parseEmail(fixtureStream('substack-newsletter.eml'));
    expect(parsed.fromAddress).toBe(parsed.fromAddress.toLowerCase());
  });
});
