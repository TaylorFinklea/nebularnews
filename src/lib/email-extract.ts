import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

// Pure HTML→article body extractor for email newsletters. Reuses the same
// Readability + linkedom approach src/lib/scraper.ts uses for web pages.
// Falls back to plain text when HTML is missing or Readability returns
// nothing usable.

export interface ExtractedBody {
  contentHtml: string;
  contentText: string;
  excerpt: string;
  wordCount: number;
  imageUrl: string | null;
}

const EMPTY: ExtractedBody = {
  contentHtml: '',
  contentText: '',
  excerpt: '',
  wordCount: 0,
  imageUrl: null,
};

function firstImageFromHtml(html: string): string | null {
  const m = html.match(/<img[^>]*\bsrc="(https?:\/\/[^"]+)"/i);
  return m ? m[1] : null;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function plainTextFallback(text: string): ExtractedBody {
  const cleaned = text.trim();
  if (cleaned.length === 0) return EMPTY;
  return {
    contentHtml: '',
    contentText: cleaned,
    excerpt: cleaned.slice(0, 300),
    wordCount: countWords(cleaned),
    imageUrl: null,
  };
}

export function extractEmailBody(html: string | null, text: string | null): ExtractedBody {
  // No content at all.
  if (!html && !text) return EMPTY;

  // No HTML: just clean text.
  if (!html) return plainTextFallback(text!);

  // Try Readability.
  try {
    const { document } = parseHTML(html);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new Readability(document as any);
    const article = reader.parse();
    if (article && article.textContent && article.textContent.trim().length > 0) {
      const contentText = article.textContent.trim();
      const contentHtml = article.content ?? html;
      return {
        contentHtml,
        contentText,
        excerpt: contentText.slice(0, 300),
        wordCount: countWords(contentText),
        imageUrl: firstImageFromHtml(html),
      };
    }
  } catch {
    // Readability threw — fall through to text fallback if available.
  }

  // Readability produced nothing usable: fall back to text if we have it.
  if (text && text.trim().length > 0) return plainTextFallback(text);

  // Last resort: strip tags crudely from the HTML.
  const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    contentHtml: html,
    contentText: stripped,
    excerpt: stripped.slice(0, 300),
    wordCount: countWords(stripped),
    imageUrl: firstImageFromHtml(html),
  };
}
