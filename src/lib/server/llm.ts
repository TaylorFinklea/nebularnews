export type Provider = 'openai' | 'anthropic';
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type SummaryStyle = 'concise' | 'detailed' | 'bullet';
export type SummaryLength = 'short' | 'medium' | 'long';
export type LlmOptions = { reasoningEffort?: ReasoningEffort };
export type ScorePromptConfig = {
  systemPrompt: string;
  userPromptTemplate: string;
};

export type LlmUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

const parseJson = (text: string) => {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to slice-based parsing.
    }
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};

const summaryConstraints: Record<SummaryLength, { minWords: number; maxWords: number }> = {
  short: { minWords: 28, maxWords: 55 },
  medium: { minWords: 55, maxWords: 95 },
  long: { minWords: 95, maxWords: 170 }
};

const keyPointCountByLength: Record<SummaryLength, number> = {
  short: 4,
  medium: 6,
  long: 8
};

const clampWords = (text: string, maxWords: number) => {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(' ').trim()}...`;
};

const normalizeParagraphSummary = (text: string, length: SummaryLength) => {
  const withoutListMarkers = text
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+[\).]\s+/gm, '');
  const flattened = withoutListMarkers.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  return clampWords(flattened, summaryConstraints[length].maxWords);
};

const normalizeBulletSummary = (text: string, length: SummaryLength) => {
  const maxBullets = keyPointCountByLength[length];
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').replace(/^\s*\d+[\).]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, maxBullets)
    .map((line) => `- ${clampWords(line, 16)}`);

  if (lines.length > 0) return lines.join('\n');

  const fallback = normalizeParagraphSummary(text, length);
  return `- ${fallback}`;
};

const normalizeKeyPoints = (input: unknown, length: SummaryLength) => {
  const raw = Array.isArray(input)
    ? input
    : String(input ?? '')
        .split('\n')
        .map((line) => line.trim());

  const cleaned = raw
    .map((entry) => String(entry ?? '').trim())
    .map((entry) => entry.replace(/^\s*[-*•]\s*/, '').replace(/^\s*\d+[\).]\s*/, '').trim())
    .filter(Boolean);

  const deduped = [...new Set(cleaned)];
  return deduped.slice(0, keyPointCountByLength[length]).map((point) => clampWords(point, 18));
};

const normalizeTagName = (value: unknown) =>
  String(value ?? '')
    .replace(/^\s*[-*•]\s*/, '')
    .replace(/^\s*\d+[\).]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);

const normalizeTagConfidence = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
};

const normalizeTagCandidates = (input: unknown, maxTags: number) => {
  const entries = Array.isArray(input)
    ? input
    : String(input ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

  const normalized = entries
    .map((entry) => {
      if (typeof entry === 'string') {
        return { name: normalizeTagName(entry), confidence: null };
      }
      const row = entry as Record<string, unknown>;
      const name = normalizeTagName(row.name ?? row.tag ?? row.label);
      const confidence = normalizeTagConfidence(row.confidence ?? row.score);
      return { name, confidence };
    })
    .filter((entry) => entry.name.length > 0);

  const deduped = new Map<string, { name: string; confidence: number | null }>();
  for (const entry of normalized) {
    const key = entry.name.toLowerCase();
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, entry);
      continue;
    }
    const betterConfidence =
      existing.confidence === null
        ? entry.confidence
        : entry.confidence === null
          ? existing.confidence
          : Math.max(existing.confidence, entry.confidence);
    deduped.set(key, {
      name: existing.name.length >= entry.name.length ? existing.name : entry.name,
      confidence: betterConfidence
    });
  }

  return [...deduped.values()].slice(0, maxTags);
};

const buildSummaryInstruction = (style: SummaryStyle, length: SummaryLength) => {
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
};

const supportsReasoningFallback = (status: number, bodyText: string) =>
  status === 400 &&
  /reasoning|reasoning_effort|unknown parameter|additional properties|schema/i.test(bodyText);

const supportsTemperatureFallback = (status: number, bodyText: string) =>
  status === 400 && /temperature|unsupported value|does not support/i.test(bodyText);

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

const renderScorePromptTemplate = (
  template: string,
  values: { profile: string; title: string; url: string; content: string }
) =>
  template.replace(/\{\{\s*(profile|title|url|content)\s*\}\}/g, (_, key: keyof typeof values) => values[key]);

const buildOpenAiPayloads = (model: string, messages: ChatMessage[], effort?: ReasoningEffort) => {
  const basePayload = {
    model,
    messages
  };
  const tempPayload = { ...basePayload, temperature: 0.2 };

  const payloads = effort
    ? [
        { ...tempPayload, reasoning: { effort } },
        { ...tempPayload, reasoning_effort: effort },
        tempPayload,
        { ...basePayload, reasoning: { effort } },
        { ...basePayload, reasoning_effort: effort },
        basePayload
      ]
    : [tempPayload, basePayload];

  const dedupe = new Map<string, (typeof payloads)[number]>();
  for (const payload of payloads) {
    dedupe.set(JSON.stringify(payload), payload);
  }
  return [...dedupe.values()];
};

const callOpenAI = async (apiKey: string, model: string, messages: ChatMessage[], options?: LlmOptions) => {
  const effort = options?.reasoningEffort;

  const payloads = buildOpenAiPayloads(model, messages, effort);

  let lastError = '';
  for (const payload of payloads) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content ?? '';
      const usage = data.usage ?? {};
      return { content, usage };
    }

    const bodyText = await res.text();
    lastError = `OpenAI error: ${res.status} ${bodyText}`.trim();

    // Some models/endpoints reject reasoning keys or temperature overrides. Fall through to a compatible payload.
    const usesReasoning = 'reasoning' in payload || 'reasoning_effort' in payload;
    const usesTemperature = 'temperature' in payload;
    if (usesReasoning && supportsReasoningFallback(res.status, bodyText)) continue;
    if (usesTemperature && supportsTemperatureFallback(res.status, bodyText)) continue;

    throw new Error(lastError);
  }

  throw new Error(lastError || 'OpenAI error: unknown request failure');
};

const callAnthropic = async (apiKey: string, model: string, messages: ChatMessage[]) => {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const userMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      system,
      max_tokens: 800,
      temperature: 0.2,
      messages: userMessages
    })
  });

  if (!res.ok) {
    throw new Error(`Anthropic error: ${res.status}`);
  }

  const data = await res.json();
  const content = data.content?.[0]?.text ?? '';
  const usage = data.usage ?? {};
  return { content, usage };
};

export async function runChat(
  provider: Provider,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options?: LlmOptions
) {
  if (provider === 'openai') return callOpenAI(apiKey, model, messages, options);
  return callAnthropic(apiKey, model, messages);
}

export async function summarizeArticle(
  provider: Provider,
  apiKey: string,
  model: string,
  input: {
    title: string | null;
    url: string | null;
    contentText: string;
    style?: SummaryStyle;
    length?: SummaryLength;
  },
  options?: LlmOptions
) {
  const style: SummaryStyle = input.style ?? 'concise';
  const length: SummaryLength = input.length ?? 'short';
  const prompt = `Summarize the article below.\n\nTitle: ${input.title ?? 'Untitled'}\nURL: ${
    input.url ?? 'Unknown'
  }\n\nInstructions:\n${buildSummaryInstruction(style, length)}\n\nContent:\n${input.contentText}`;

  const { content, usage } = await runChat(
    provider,
    apiKey,
    model,
    [
      { role: 'system', content: 'You are Nebular News. Follow formatting constraints exactly.' },
      { role: 'user', content: prompt }
    ],
    options
  );

  const parsed = parseJson(content);
  const rawSummary = typeof parsed?.summary === 'string' ? parsed.summary : content.trim();
  const summary = style === 'bullet' ? normalizeBulletSummary(rawSummary, length) : normalizeParagraphSummary(rawSummary, length);

  return { summary, usage };
}

export async function generateArticleKeyPoints(
  provider: Provider,
  apiKey: string,
  model: string,
  input: { title: string | null; url: string | null; contentText: string; length?: SummaryLength },
  options?: LlmOptions
) {
  const length: SummaryLength = input.length ?? 'short';
  const targetCount = keyPointCountByLength[length];

  const prompt = `Extract the key points from this article.\n\nTitle: ${input.title ?? 'Untitled'}\nURL: ${
    input.url ?? 'Unknown'
  }\n\nRequirements:
- Return JSON only with key "key_points" (array of strings).
- Provide exactly ${targetCount} points.
- Each point must be <= 14 words.
- Focus on facts, outcomes, and concrete signals.
\nArticle:\n${input.contentText}`;

  const { content, usage } = await runChat(
    provider,
    apiKey,
    model,
    [
      { role: 'system', content: 'You extract high-signal key points for quick scanning.' },
      { role: 'user', content: prompt }
    ],
    options
  );

  const parsed = parseJson(content);
  const keyPoints = normalizeKeyPoints(parsed?.key_points ?? content, length);
  return { keyPoints, usage };
}

export async function generateArticleTags(
  provider: Provider,
  apiKey: string,
  model: string,
  input: { title: string | null; url: string | null; contentText: string; maxTags?: number },
  options?: LlmOptions
) {
  const maxTags = Math.min(12, Math.max(2, Math.floor(Number(input.maxTags ?? 6))));
  const prompt = `Generate topical tags for this article.\n\nTitle: ${input.title ?? 'Untitled'}\nURL: ${
    input.url ?? 'Unknown'
  }\n\nRequirements:
- Return JSON only with key "tags".
- "tags" must be an array with up to ${maxTags} objects.
- Each object must contain:
  - "name": short title-case tag, 1-3 words.
  - "confidence": number from 0.0 to 1.0.
- Avoid generic tags such as "News", "Update", "Article", or source names.
- Keep tags specific and reusable across similar articles.
\nArticle:\n${input.contentText}`;

  const { content, usage } = await runChat(
    provider,
    apiKey,
    model,
    [
      { role: 'system', content: 'You assign clean, specific article tags for categorization and filtering.' },
      { role: 'user', content: prompt }
    ],
    options
  );

  const parsed = parseJson(content);
  const tags = normalizeTagCandidates((parsed as Record<string, unknown> | null)?.tags ?? parsed ?? content, maxTags);
  return { tags, usage };
}

export async function scoreArticle(
  provider: Provider,
  apiKey: string,
  model: string,
  input: { title: string | null; url: string | null; contentText: string; profile: string },
  options?: LlmOptions,
  promptConfig?: ScorePromptConfig
) {
  const systemPrompt = (promptConfig?.systemPrompt ?? '').trim() || DEFAULT_SCORE_SYSTEM_PROMPT;
  const promptTemplate = (promptConfig?.userPromptTemplate ?? '').trim() || DEFAULT_SCORE_USER_PROMPT_TEMPLATE;
  const prompt = renderScorePromptTemplate(promptTemplate, {
    profile: input.profile,
    title: input.title ?? 'Untitled',
    url: input.url ?? 'Unknown',
    content: input.contentText
  });

  const { content, usage } = await runChat(provider, apiKey, model, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt }
  ], options);

  const parsed = parseJson(content) ?? {};
  const score = Math.min(5, Math.max(1, Number(parsed.score) || 3));
  const label = parsed.label ?? 'Neutral fit';
  const reason = parsed.reason ?? content.trim();
  const evidence = Array.isArray(parsed.evidence) ? parsed.evidence : [];

  return { score, label, reason, evidence, usage };
}

export async function refreshPreferenceProfile(
  provider: Provider,
  apiKey: string,
  model: string,
  input: { current: string; feedback: { rating: number; comment?: string | null; title?: string | null }[] },
  options?: LlmOptions
) {
  const feedbackText = input.feedback
    .map((f) => `Rating ${f.rating} — ${f.title ?? 'Untitled'} — ${f.comment ?? 'No comment'}`)
    .join('\n');

  const prompt = `Update the user's preference profile based on recent feedback.\n\nCurrent profile:\n${
    input.current
  }\n\nRecent feedback:\n${feedbackText}\n\nReturn a concise updated profile (plain text).`;

  const { content } = await runChat(provider, apiKey, model, [
    { role: 'system', content: 'You summarize user preferences for personalized news.' },
    { role: 'user', content: prompt }
  ], options);

  return content.trim();
}
