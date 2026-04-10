import type { Provider } from './model-config';

export type { Provider } from './model-config';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LlmUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type LlmOptions = {
  maxTokens?: number;
};

const AI_FETCH_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Fetch with timeout (CF Workers compatible)
// ---------------------------------------------------------------------------

async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------

export function parseJsonResponse(text: string): unknown | null {
  const trimmed = text.trim();

  // Try direct parse first.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through.
    }
  }

  // Strip markdown code fences if present.
  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Fall through.
    }
  }

  // Slice from first { to last }.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // Fall through.
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Provider callers
// ---------------------------------------------------------------------------

async function callOpenAI(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options?: LlmOptions,
): Promise<{ content: string; usage: LlmUsage }> {
  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.2,
  };
  if (options?.maxTokens) {
    payload.max_tokens = options.maxTokens;
  }

  const res = await fetchWithTimeout(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    AI_FETCH_TIMEOUT_MS,
  );

  if (!res.ok) {
    const body = await res.text();
    // If the model rejects temperature, retry without it.
    if (
      res.status === 400 &&
      /temperature|unsupported value|does not support/i.test(body)
    ) {
      delete payload.temperature;
      const retry = await fetchWithTimeout(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
        AI_FETCH_TIMEOUT_MS,
      );
      if (!retry.ok) {
        const retryBody = await retry.text();
        throw new Error(`OpenAI error: ${retry.status} ${retryBody}`);
      }
      const data = (await retry.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: LlmUsage;
      };
      return {
        content: data.choices?.[0]?.message?.content ?? '',
        usage: data.usage ?? {},
      };
    }
    throw new Error(`OpenAI error: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: LlmUsage;
  };
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    usage: data.usage ?? {},
  };
}

async function callAnthropic(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options?: LlmOptions,
): Promise<{ content: string; usage: LlmUsage }> {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const userMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const res = await fetchWithTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system,
        max_tokens: options?.maxTokens ?? 800,
        temperature: 0.2,
        messages: userMessages,
      }),
    },
    AI_FETCH_TIMEOUT_MS,
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic error: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ text?: string }>;
    usage?: LlmUsage;
  };
  return {
    content: data.content?.[0]?.text ?? '',
    usage: data.usage ?? {},
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runChat(
  provider: Provider,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options?: LlmOptions,
): Promise<{ content: string; usage: LlmUsage }> {
  if (provider === 'openai') return callOpenAI(apiKey, model, messages, options);
  return callAnthropic(apiKey, model, messages, options);
}
