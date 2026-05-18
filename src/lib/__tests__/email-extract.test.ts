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
});
