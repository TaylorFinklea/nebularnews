export type ExtractionMethod = 'readability' | 'fallback' | 'feed_only' | 'browser';

export type ContentQualitySignal = {
  name: string;
  value: number;
  weight: number;
};

export type ExtractionResult = {
  method: ExtractionMethod;
  quality: number;
  signals: ContentQualitySignal[];
};

export const POOR_EXTRACTION_THRESHOLD = 0.35;
export const BROWSER_SCRAPE_QUALITY_THRESHOLD = 0.30;

// Feed auto-learning constants
export const MIN_ARTICLES_FOR_AUTO_FLAG = 8;
export const FAIL_RATE_THRESHOLD = 0.6;

const ramp = (value: number, min: number, max: number): number => {
  if (value <= min) return 0;
  if (value >= max) return 1;
  return (value - min) / (max - min);
};

const BOILERPLATE_PATTERNS = [
  /\bread more\b/i,
  /\bsubscribe\b/i,
  /\bcookie/i,
  /\baccept all\b/i,
  /\bsign in\b/i,
  /\blog in\b/i,
  /\bshare this\b/i,
  /\bnewsletter\b/i,
  /\badvertisement\b/i,
  /\bsponsored\b/i,
  /\bprivacy policy\b/i,
  /\bterms of service\b/i,
  /\bmenu\b/i,
  /\bskip to content\b/i,
  /\bclose\b/i
];

function scoreWordCount(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return ramp(words, 100, 800);
}

function scoreParagraphStructure(text: string, html: string | null): number {
  // Count paragraphs from HTML <p> tags or double newlines in text
  let paragraphCount = 0;
  if (html) {
    const matches = html.match(/<p[\s>]/gi);
    paragraphCount = matches?.length ?? 0;
  }
  if (paragraphCount === 0) {
    paragraphCount = text.split(/\n\n+/).filter((s) => s.trim().length > 0).length;
  }
  return ramp(paragraphCount, 1, 5);
}

function scoreSentenceQuality(text: string): number {
  // Ratio of text that appears in sentences >= 10 words
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  if (sentences.length === 0) return 0;
  const totalWords = text.split(/\s+/).filter(Boolean).length;
  if (totalWords === 0) return 0;
  const substantiveWords = sentences
    .filter((s) => s.trim().split(/\s+/).length >= 10)
    .reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0);
  return Math.min(1, substantiveWords / totalWords);
}

function scoreNavBoilerplate(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  let boilerplateHits = 0;
  for (const pattern of BOILERPLATE_PATTERNS) {
    const matches = text.match(new RegExp(pattern, 'gi'));
    if (matches) boilerplateHits += matches.length;
  }
  const ratio = Math.min(1, boilerplateHits / Math.max(1, words.length / 10));
  return 1 - ratio;
}

function scoreExcerptCoverage(contentText: string, feedExcerpt: string | null): number {
  if (!feedExcerpt || feedExcerpt.length < 20) return 0.5; // neutral if no excerpt to compare
  if (contentText.length >= feedExcerpt.length) return 1.0;
  return contentText.length / feedExcerpt.length;
}

export function assessExtractionQuality(params: {
  contentText: string | null;
  contentHtml: string | null;
  feedExcerpt: string | null;
  feedContentText: string | null;
  title: string | null;
  readabilitySucceeded: boolean;
}): ExtractionResult {
  const { contentText, contentHtml, feedExcerpt, readabilitySucceeded } = params;

  if (!contentText || contentText.trim().length === 0) {
    const method: ExtractionMethod = readabilitySucceeded ? 'readability' : 'fallback';
    return {
      method,
      quality: 0,
      signals: [
        { name: 'word_count', value: 0, weight: 0.25 },
        { name: 'paragraph_structure', value: 0, weight: 0.20 },
        { name: 'sentence_quality', value: 0, weight: 0.15 },
        { name: 'nav_boilerplate', value: 0, weight: 0.15 },
        { name: 'excerpt_coverage', value: 0, weight: 0.10 },
        { name: 'readability_success', value: 0, weight: 0.15 }
      ]
    };
  }

  const method: ExtractionMethod = readabilitySucceeded ? 'readability' : 'fallback';

  const signals: ContentQualitySignal[] = [
    { name: 'word_count', value: scoreWordCount(contentText), weight: 0.25 },
    { name: 'paragraph_structure', value: scoreParagraphStructure(contentText, contentHtml), weight: 0.20 },
    { name: 'sentence_quality', value: scoreSentenceQuality(contentText), weight: 0.15 },
    { name: 'nav_boilerplate', value: scoreNavBoilerplate(contentText), weight: 0.15 },
    { name: 'excerpt_coverage', value: scoreExcerptCoverage(contentText, feedExcerpt), weight: 0.10 },
    { name: 'readability_success', value: readabilitySucceeded ? 1.0 : 0.0, weight: 0.15 }
  ];

  const quality = signals.reduce((sum, s) => sum + s.value * s.weight, 0);

  return { method, quality, signals };
}

export function shouldAutoEnableBrowserScrape(successCount: number, failCount: number): boolean {
  const total = successCount + failCount;
  if (total < MIN_ARTICLES_FOR_AUTO_FLAG) return false;
  const failRate = failCount / total;
  return failRate >= FAIL_RATE_THRESHOLD;
}
