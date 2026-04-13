import type { ChatMessage } from './ai';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export type SummaryStyle = 'concise' | 'detailed' | 'bullet';
export type SummaryLength = 'short' | 'medium' | 'long';

const summaryConstraints: Record<
  SummaryLength,
  { minWords: number; maxWords: number }
> = {
  short: { minWords: 28, maxWords: 55 },
  medium: { minWords: 55, maxWords: 95 },
  long: { minWords: 95, maxWords: 170 },
};

const keyPointCountByLength: Record<SummaryLength, number> = {
  short: 4,
  medium: 6,
  long: 8,
};

export const DEFAULT_SCORE_SYSTEM_PROMPT =
  'You are a transparent relevance scorer. Judge fit against the user profile only, not writing quality.';

export const DEFAULT_SCORE_USER_PROMPT_TEMPLATE = `You are scoring how well this article matches the user's preferences.

Preferences:
{{profile}}

Article:
Title: {{title}}
URL: {{url}}

Content:
{{content}}

Return JSON with keys:
- score (1-5 integer)
- label (short text)
- reason (one paragraph)
- evidence (array of short quoted snippets from article content)`;

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------

function buildSummaryInstruction(
  style: SummaryStyle,
  length: SummaryLength,
): string {
  const bounds = summaryConstraints[length];
  if (style === 'bullet') {
    return `Write ${keyPointCountByLength[length]} concise bullet points only.
- Each bullet must be <= 14 words.
- No intro text and no conclusion.
- Output plain text bullets.`;
  }

  const styleHint =
    style === 'concise'
      ? 'Keep only the most important facts and outcome.'
      : 'Include key context and why it matters in addition to core facts.';
  return `Write a single plain-text paragraph (no bullets, no numbering, no markdown).
- Target ${bounds.minWords}-${bounds.maxWords} words.
- ${styleHint}
- Do not include a "Key points" section.`;
}

function renderScorePromptTemplate(
  template: string,
  values: { profile: string; title: string; url: string; content: string },
): string {
  return template.replace(
    /\{\{\s*(profile|title|url|content)\s*\}\}/g,
    (_, key: string) => values[key as keyof typeof values],
  );
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/** Build messages for article summarization. */
export function buildSummarizePrompt(
  title: string | null,
  url: string | null,
  contentText: string,
  style: SummaryStyle = 'concise',
  length: SummaryLength = 'short',
): ChatMessage[] {
  const prompt = `Summarize the article below.

Title: ${title ?? 'Untitled'}
URL: ${url ?? 'Unknown'}

Instructions:
${buildSummaryInstruction(style, length)}

Content:
${contentText}`;

  return [
    {
      role: 'system',
      content: 'You are Nebular News. Follow formatting constraints exactly.',
    },
    { role: 'user', content: prompt },
  ];
}

/** Build messages for key-point extraction. */
export function buildKeyPointsPrompt(
  title: string | null,
  url: string | null,
  contentText: string,
  length: SummaryLength = 'short',
): ChatMessage[] {
  const targetCount = keyPointCountByLength[length];

  const prompt = `Extract the key points from this article.

Title: ${title ?? 'Untitled'}
URL: ${url ?? 'Unknown'}

Requirements:
- Return JSON only with key "key_points" (array of strings).
- Provide exactly ${targetCount} points.
- Each point must be <= 14 words.
- Focus on facts, outcomes, and concrete signals.

Article:
${contentText}`;

  return [
    {
      role: 'system',
      content: 'You extract high-signal key points for quick scanning.',
    },
    { role: 'user', content: prompt },
  ];
}

/** Build messages for relevance scoring. */
export function buildScorePrompt(
  title: string | null,
  url: string | null,
  contentText: string,
  profile: string,
  systemPrompt?: string,
): ChatMessage[] {
  const system =
    (systemPrompt ?? '').trim() || DEFAULT_SCORE_SYSTEM_PROMPT;
  const userPrompt = renderScorePromptTemplate(
    DEFAULT_SCORE_USER_PROMPT_TEMPLATE,
    {
      profile,
      title: title ?? 'Untitled',
      url: url ?? 'Unknown',
      content: contentText,
    },
  );

  return [
    { role: 'system', content: system },
    { role: 'user', content: userPrompt },
  ];
}

/** Build messages for auto-tagging with existing candidates. */
export function buildAutoTagPrompt(
  title: string | null,
  url: string | null,
  contentText: string,
  candidates: Array<{ id: string; name: string }>,
  maxTags: number = 5,
): ChatMessage[] {
  const safeCandidates = candidates
    .filter((c) => c.id && c.name)
    .slice(0, 50);
  const candidateText =
    safeCandidates.length > 0
      ? safeCandidates.map((c) => `- ${c.name} (id: ${c.id})`).join('\n')
      : '- No existing tags available.';

  const prompt = `Assign tags for this article.

Title: ${title ?? 'Untitled'}
URL: ${url ?? 'Unknown'}

Existing tag candidates:
${candidateText}

Requirements:
- Return JSON only.
- JSON keys:
  - "matched_existing_tag_ids": array of IDs selected only from candidate IDs above.
  - "new_suggestions": array of objects with:
    - "name": short title-case tag, 1-3 words.
    - "confidence": number from 0.0 to 1.0.
- Total tags across matched_existing_tag_ids + new_suggestions must be <= ${maxTags}.
- Prefer existing candidates whenever they fit.
- If no good match exists, include concise new suggestions.
- Avoid generic tags such as "News", "Update", "Article", or source names.

Article:
${contentText}`;

  return [
    {
      role: 'system',
      content:
        'You classify articles into reusable taxonomy tags. Prefer selecting from provided existing tags.',
    },
    { role: 'user', content: prompt },
  ];
}

/** Build messages for generating suggested questions about an article. */
export function buildSuggestedQuestionsPrompt(
  title: string | null,
  url: string | null,
  contentText: string,
  summaryText: string | null,
): ChatMessage[] {
  let context = `Title: ${title ?? 'Untitled'}\nURL: ${url ?? 'Unknown'}\n\nContent:\n${contentText}`;
  if (summaryText) {
    context += `\n\nSummary: ${summaryText}`;
  }

  const prompt = `Generate 3 thoughtful questions a reader might ask about this article.

${context}

Requirements:
- Return JSON only with key "questions" (array of strings).
- Each question should be specific to the article's content, not generic.
- Vary the depth: one factual question, one analytical question, one connecting to broader context.
- Each question must be <= 15 words.
- Questions should be things the article can answer or meaningfully discuss.`;

  return [
    {
      role: 'system',
      content: 'You generate engaging, specific questions that help readers think more deeply about articles.',
    },
    { role: 'user', content: prompt },
  ];
}

/** Build messages for news brief generation. */
export function buildNewsBriefPrompt(
  candidates: Array<{
    id: string;
    title: string | null;
    sourceName: string | null;
    publishedAt: number | null;
    effectiveScore: number;
    context: string;
  }>,
  windowLabel: string,
  maxBullets: number = 5,
  maxWordsPerBullet: number = 18,
): ChatMessage[] {
  const cappedBullets = Math.min(8, Math.max(1, Math.floor(maxBullets)));

  const candidateText = candidates
    .map((c) => {
      const publishedAt = c.publishedAt
        ? new Date(c.publishedAt).toISOString()
        : 'unknown';
      return [
        `ID: ${c.id}`,
        `Title: ${c.title ?? 'Untitled'}`,
        `Source: ${c.sourceName ?? 'Unknown source'}`,
        `Published: ${publishedAt}`,
        `Fit score: ${c.effectiveScore}/5`,
        `Context: ${c.context || 'No context available.'}`,
      ].join('\n');
    })
    .join('\n\n---\n\n');

  const prompt = `Create a concise editorial news briefing from these articles.

Window: ${windowLabel}

Requirements:
- Return JSON only.
- JSON shape:
  {
    "bullets": [
      {
        "text": "concise factual bullet",
        "source_article_ids": ["candidate-id-1"]
      }
    ]
  }
- Provide up to ${cappedBullets} bullets.
- Each bullet must be <= ${maxWordsPerBullet} words.
- Each bullet must summarize exactly one notable article from the candidate list.
- Each bullet must cite exactly one source_article_id selected only from the article IDs provided below.
- Favor the highest-fit and most recent developments.
- Do not invent facts, article IDs, or entities not supported by the supplied context.

Candidate articles:
${candidateText}`;

  return [
    {
      role: 'system',
      content:
        'You write polished newsroom briefings. Follow the JSON schema exactly. Each bullet must map to exactly one provided article ID.',
    },
    { role: 'user', content: prompt },
  ];
}
