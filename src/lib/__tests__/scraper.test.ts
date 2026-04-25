import { describe, it, expect } from 'vitest';
import { sniffContentType, UNSUPPORTED_EXTRACTION_METHODS } from '../scraper';

describe('sniffContentType', () => {
  it('detects PDF responses by magic header', () => {
    expect(sniffContentType('%PDF-1.7\n%¥±ë\n')).toBe('pdf');
    // Real Steel/Browserless responses sometimes prefix with whitespace.
    expect(sniffContentType('  %PDF-1.4\n')).toBe('pdf');
  });

  it('detects JSON bodies', () => {
    expect(sniffContentType('{"hello":"world"}')).toBe('json');
    expect(sniffContentType('[1,2,3]')).toBe('json');
    expect(sniffContentType('  {\n  "x": 1\n}')).toBe('json');
  });

  it('classifies real HTML as html', () => {
    expect(sniffContentType('<!doctype html>\n<html>...')).toBe('html');
    expect(sniffContentType('<html><body>Hello</body></html>')).toBe('html');
  });

  it('classifies plain text as html (the default)', () => {
    // Not great, but consistent: plain text falls through to Readability,
    // which will produce a low-quality result that the retry cron handles.
    expect(sniffContentType('Hello, this is a plain string')).toBe('html');
  });

  it('handles empty input without throwing', () => {
    expect(sniffContentType('')).toBe('html');
  });
});

describe('UNSUPPORTED_EXTRACTION_METHODS', () => {
  it('contains the three structured failure markers', () => {
    expect(UNSUPPORTED_EXTRACTION_METHODS.has('unsupported_content_type')).toBe(true);
    expect(UNSUPPORTED_EXTRACTION_METHODS.has('parse_failed')).toBe(true);
    expect(UNSUPPORTED_EXTRACTION_METHODS.has('no_readable_content')).toBe(true);
  });

  it('does not include successful provider names', () => {
    expect(UNSUPPORTED_EXTRACTION_METHODS.has('steel')).toBe(false);
    expect(UNSUPPORTED_EXTRACTION_METHODS.has('browserless')).toBe(false);
    expect(UNSUPPORTED_EXTRACTION_METHODS.has('readability')).toBe(false);
  });
});
