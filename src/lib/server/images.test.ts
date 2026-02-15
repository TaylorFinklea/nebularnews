import { describe, expect, it } from 'vitest';
import { extractLeadImageUrlFromHtml } from './images';

describe('extractLeadImageUrlFromHtml', () => {
  it('extracts og:image when present', () => {
    const html = `
      <html>
        <head>
          <meta property="og:image" content="https://cdn.example.com/hero.jpg" />
        </head>
        <body><p>Article</p></body>
      </html>
    `;
    expect(extractLeadImageUrlFromHtml(html, 'https://example.com/post')).toBe('https://cdn.example.com/hero.jpg');
  });

  it('extracts first non-decorative img in body', () => {
    const html = `
      <html>
        <body>
          <img src="/logo.png" width="80" height="80" />
          <img src="/media/hero.jpg" width="600" height="350" />
        </body>
      </html>
    `;
    expect(extractLeadImageUrlFromHtml(html, 'https://example.com/post')).toBe('https://example.com/media/hero.jpg');
  });
});
