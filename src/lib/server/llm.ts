export type Provider = 'openai' | 'anthropic';
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type LlmOptions = { reasoningEffort?: ReasoningEffort };

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

const callOpenAI = async (apiKey: string, model: string, messages: ChatMessage[], options?: LlmOptions) => {
  const basePayload = {
    model,
    messages,
    temperature: 0.2
  };
  const effort = options?.reasoningEffort;

  const payloads = effort
    ? [
        { ...basePayload, reasoning: { effort } },
        { ...basePayload, reasoning_effort: effort },
        basePayload
      ]
    : [basePayload];

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

    // Some models/endpoints reject reasoning keys. Fall through to a compatible payload.
    if (effort && supportsReasoningFallback(res.status, bodyText)) continue;

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
  options?: LlmOptions
) {
  const prompt = `You are scoring how well this article matches the user's preferences.\n\nPreferences:\n${
    input.profile
  }\n\nArticle:\nTitle: ${input.title ?? 'Untitled'}\nURL: ${input.url ?? 'Unknown'}\n\nContent:\n${
    input.contentText
  }\n\nReturn JSON with keys: score (1-5 integer), label, reason, evidence (array of short quotes).`;

  const { content, usage } = await runChat(provider, apiKey, model, [
    { role: 'system', content: 'You are a transparent relevance scorer.' },
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
