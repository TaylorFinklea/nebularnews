export type Provider = 'openai' | 'anthropic';
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
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
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
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
  input: { title: string | null; url: string | null; contentText: string },
  options?: LlmOptions
) {
  const prompt = `Summarize the article below. Return JSON with keys: summary, key_points (array).\n\nTitle: ${
    input.title ?? 'Untitled'
  }\nURL: ${input.url ?? 'Unknown'}\n\nContent:\n${input.contentText}`;

  const { content, usage } = await runChat(provider, apiKey, model, [
    { role: 'system', content: 'You are Nebular News, a concise summarizer.' },
    { role: 'user', content: prompt }
  ], options);

  const parsed = parseJson(content);
  const summary = parsed?.summary ?? content.trim();
  const keyPoints = Array.isArray(parsed?.key_points) ? parsed.key_points : [];

  return { summary, keyPoints, usage };
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
