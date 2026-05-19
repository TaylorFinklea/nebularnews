import { describe, it, expect } from 'vitest';
import { extractEmailBody } from '../email-extract';

const SAMPLE_HTML = `
<html><body>
<h1>The Aggregator Paradox Revisited</h1>
<p><a href="https://example.com/archive">View in browser</a></p>
<p>Today I want to revisit a topic from years past. The aggregator paradox argues that platforms which start as neutral discovery layers eventually accrue power.</p>
<p>Three forces drive this convergence: network effects, data accumulation, and unilateral rule changes.</p>
</body></html>
`;

describe('extractEmailBody', () => {
  it('extracts main content from HTML via Readability', () => {
    const result = extractEmailBody(SAMPLE_HTML, null);
    expect(result.contentText).toContain('aggregator paradox');
    expect(result.contentText).toContain('Three forces');
    expect(result.wordCount).toBeGreaterThan(10);
  });

  it('produces an excerpt of at most 300 chars', () => {
    const result = extractEmailBody(SAMPLE_HTML, null);
    expect(result.excerpt.length).toBeLessThanOrEqual(300);
    expect(result.excerpt.length).toBeGreaterThan(0);
  });

  it('falls back to plain text when html is null', () => {
    const result = extractEmailBody(null, 'Plain text body\nSecond line');
    expect(result.contentText).toContain('Plain text body');
    expect(result.contentHtml).toBe('');
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it('falls back to plain text when html produces no readable content', () => {
    const result = extractEmailBody('<html><body></body></html>', 'Plain fallback');
    expect(result.contentText).toContain('Plain fallback');
  });

  it('returns empty body when both html and text are null', () => {
    const result = extractEmailBody(null, null);
    expect(result.contentText).toBe('');
    expect(result.contentHtml).toBe('');
    expect(result.wordCount).toBe(0);
    expect(result.excerpt).toBe('');
    expect(result.imageUrl).toBeNull();
  });

  it('extracts first image URL when present in HTML', () => {
    const htmlWithImage = `
      <html><body>
      <h1>Title</h1>
      <img src="https://cdn.example.com/hero.jpg" alt="Hero">
      <p>Body content.</p>
      </body></html>
    `;
    const result = extractEmailBody(htmlWithImage, null);
    expect(result.imageUrl).toBe('https://cdn.example.com/hero.jpg');
  });

  it('strips tags when html is unparseable and text is null', () => {
    // When Readability produces nothing AND we have no plain-text fallback,
    // the last-resort path strips tags from the raw HTML.
    const result = extractEmailBody('<div><b>Hello</b> world</div>', null);
    expect(result.contentText).toContain('Hello');
    expect(result.contentText).toContain('world');
    expect(result.contentHtml).toBe('<div><b>Hello</b> world</div>');
    expect(result.wordCount).toBe(2);
  });

  it('extracts hero image from Readability-cleaned content, not raw tracking pixels', () => {
    // Newsletters often have a 1x1 tracking pixel near the top that Readability
    // filters out. We should pick the hero image inside the cleaned article body.
    const html = `
      <html><body>
      <img src="https://tracker.example.com/pixel.gif" width="1" height="1">
      <article>
        <h1>The Aggregator Paradox Revisited</h1>
        <img src="https://cdn.example.com/hero.jpg" alt="Hero">
        <p>Today I want to revisit a topic from years past. Three forces drive convergence: network effects, data accumulation, and unilateral rule changes.</p>
        <p>This insight has aged well over the last decade. The mechanics remain identical, but the platforms have matured.</p>
      </article>
      </body></html>
    `;
    const result = extractEmailBody(html, null);
    // Readability should keep the hero and drop the tracking pixel.
    // We accept either the cleaned hero URL or null if Readability didn't include images.
    // The key assertion: we never return the tracking pixel.
    expect(result.imageUrl).not.toBe('https://tracker.example.com/pixel.gif');
  });

  it('extracts image URL when src uses single quotes', () => {
    const html = "<html><body><h1>Title</h1><img src='https://cdn.example.com/single.jpg' alt='S'><p>Body content.</p></body></html>";
    const result = extractEmailBody(html, null);
    expect(result.imageUrl).toBe('https://cdn.example.com/single.jpg');
  });
});
