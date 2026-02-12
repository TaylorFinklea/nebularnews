import { describe, expect, it } from 'vitest';
import { extractMainContent, htmlToText } from './text';

describe('htmlToText', () => {
  it('handles plain text input without throwing', () => {
    expect(htmlToText('Just text')).toBe('Just text');
  });

  it('extracts readable text from html', () => {
    expect(htmlToText('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
  });
});

describe('extractMainContent', () => {
  it('returns fallback content for plain text input', () => {
    const result = extractMainContent('No tags here');
    expect(result.contentText).toBe('No tags here');
  });
});
