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

// ---------------------------------------------------------------------------
// AI Assistant — context-aware system prompt
// ---------------------------------------------------------------------------

export type AssistantPageContext = {
  pageType: string;
  pageLabel: string;
  articles?: Array<{ id: string; title: string; score?: number; source?: string; date?: string; isRead?: boolean }>;
  articleDetail?: {
    articleId: string;
    title: string;
    summary?: string;
    keyPoints?: string[];
    score?: number;
    tags?: string[];
    contentExcerpt?: string;
  };
  stats?: { unreadCount?: number; totalCount?: number; newToday?: number };
  filters?: Record<string, string>;
  tags?: string[];
  feeds?: Array<{ id: string; title: string; articleCount?: number; isPaused?: boolean }>;
  briefSummary?: string;
};

export function buildAssistantSystemPrompt(
  pageContext: AssistantPageContext,
  memoryContext: string[],
): string {
  let contextBlock = '';

  switch (pageContext.pageType) {
    case 'today': {
      const stats = pageContext.stats;
      contextBlock = `The user is on their Today dashboard.`;
      if (stats) {
        contextBlock += `\nStats: ${stats.unreadCount ?? '?'} unread, ${stats.newToday ?? '?'} new today, ${stats.totalCount ?? '?'} total articles.`;
      }
      if (pageContext.briefSummary) {
        contextBlock += `\nToday's brief: ${pageContext.briefSummary}`;
      }
      if (pageContext.articles?.length) {
        contextBlock += `\nFeatured articles:\n${pageContext.articles.map(a => `- [[article:${a.id}:${a.title}]] (score: ${a.score ?? '?'}/5, from ${a.source ?? 'unknown'})`).join('\n')}`;
      }
      break;
    }
    case 'articles': {
      contextBlock = `The user is browsing their Articles list.`;
      if (pageContext.filters && Object.keys(pageContext.filters).length > 0) {
        contextBlock += `\nActive filters: ${Object.entries(pageContext.filters).map(([k, v]) => `${k}=${v}`).join(', ')}`;
      }
      if (pageContext.articles?.length) {
        contextBlock += `\nVisible articles:\n${pageContext.articles.map(a => `- [[article:${a.id}:${a.title}]] (score: ${a.score ?? '?'}/5, from ${a.source ?? 'unknown'}, ${a.isRead ? 'read' : 'unread'})`).join('\n')}`;
      }
      break;
    }
    case 'article_detail': {
      const detail = pageContext.articleDetail;
      if (detail) {
        contextBlock = `The user is reading: "${detail.title}"`;
        if (detail.summary) contextBlock += `\nSummary: ${detail.summary}`;
        if (detail.keyPoints?.length) contextBlock += `\nKey points:\n${detail.keyPoints.map(p => `- ${p}`).join('\n')}`;
        if (detail.tags?.length) contextBlock += `\nTags: ${detail.tags.join(', ')}`;
        if (detail.score) contextBlock += `\nScore: ${detail.score}/5`;
        if (detail.contentExcerpt) contextBlock += `\nContent excerpt: ${detail.contentExcerpt}`;
      }
      break;
    }
    case 'discover': {
      contextBlock = `The user is on the Discover page.`;
      if (pageContext.tags?.length) contextBlock += `\nAvailable tags: ${pageContext.tags.slice(0, 20).join(', ')}`;
      if (pageContext.feeds?.length) contextBlock += `\n${pageContext.feeds.length} feeds subscribed.`;
      break;
    }
    case 'reading_list': {
      contextBlock = `The user is viewing their Reading List (saved articles).`;
      if (pageContext.articles?.length) {
        contextBlock += `\nSaved articles:\n${pageContext.articles.map(a => `- [[article:${a.id}:${a.title}]] (from ${a.source ?? 'unknown'})`).join('\n')}`;
      }
      break;
    }
    case 'feeds': {
      contextBlock = `The user is managing their Feed subscriptions.`;
      if (pageContext.feeds?.length) {
        contextBlock += `\nFeeds:\n${pageContext.feeds.map(f => `- ${f.title}${f.isPaused ? ' (paused)' : ''} — ${f.articleCount ?? '?'} articles`).join('\n')}`;
      }
      break;
    }
    default:
      contextBlock = `The user is on: ${pageContext.pageLabel}`;
  }

  const memory = memoryContext.length > 0
    ? `\n\nPrevious discussions:\n${memoryContext.map(s => `- ${s}`).join('\n')}`
    : '';

  return `You are the NebularNews AI assistant. You help the user understand and navigate their personalized news feed.

Current page: ${pageContext.pageLabel}

${contextBlock}

Guidelines:
- When referencing articles, use this exact format: [[article:ARTICLE_ID:Article Title]]. These render as tappable cards.
- Be concise and actionable. Use markdown for emphasis and structure.
- You can help with: finding articles, explaining content, comparing stories, identifying trends, managing feeds, and answering questions about the user's news.
- If the user asks to find or filter articles, describe the results clearly with article references.
- After your response, suggest 2-3 follow-up questions on new lines prefixed with ">>".

Tools:
You have access to tools that let you take direct actions on the user's behalf. Use them when the user's intent is clearly an action, not just a question.
- Prefer calling a tool over describing how the user could do it themselves.
- For read-only research (search_articles, list_feeds, get_trending_topics, get_article_summary), call the tool to ground your answer in current data rather than guessing.
- For mutations (mark_articles_read, set_article_reaction, apply_tag_to_article, set_feed_max_per_day, pause_feed), confirm you understood the scope when the action affects many items.
- Navigation tools (open_article, navigate_to_tab, set_articles_filter, generate_brief_now) dispatch on the iPhone — don't also describe the result in prose beyond one short sentence.
- If a tool result surfaces an error (succeeded=false in the chip), acknowledge briefly and offer an alternative.
- Do not invent article ids. Only act on ids that appear in the current page context or in a tool result from this turn.${memory}`;
}
