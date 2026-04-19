import type { Provider } from './model-config';
import { withRetry, type RetryOptions } from './retry';

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
const AI_STREAM_TIMEOUT_MS = 120_000;

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
  options?: LlmOptions & { retry?: RetryOptions },
): Promise<{ content: string; usage: LlmUsage }> {
  const call = () => {
    if (provider === 'openai') return callOpenAI(apiKey, model, messages, options);
    return callAnthropic(apiKey, model, messages, options);
  };
  return withRetry(call, options?.retry);
}

// ---------------------------------------------------------------------------
// Tool calling — non-streaming
// ---------------------------------------------------------------------------

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type ToolResultMessage = {
  role: 'tool';
  callId: string;
  content: string;
};

export type AssistantToolCallsMessage = {
  role: 'assistant';
  content: string;
  toolCalls: ToolCall[];
};

export type ExtendedChatMessage = ChatMessage | AssistantToolCallsMessage | ToolResultMessage;

export type RunChatToolResult =
  | { kind: 'message'; content: string; usage: LlmUsage }
  | { kind: 'toolCalls'; preface: string; toolCalls: ToolCall[]; usage: LlmUsage };

async function callOpenAIWithTools(
  apiKey: string,
  model: string,
  messages: ExtendedChatMessage[],
  tools: ToolDefinition[],
  options?: LlmOptions,
): Promise<RunChatToolResult> {
  const openaiMessages = messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool' as const, tool_call_id: m.callId, content: m.content };
    }
    if (m.role === 'assistant' && 'toolCalls' in m) {
      return {
        role: 'assistant' as const,
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });

  const payload: Record<string, unknown> = {
    model,
    messages: openaiMessages,
    temperature: 0.2,
    tools: tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
  };
  if (options?.maxTokens) payload.max_tokens = options.maxTokens;

  const res = await fetchWithTimeout(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    AI_FETCH_TIMEOUT_MS,
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
    }>;
    usage?: LlmUsage;
  };
  const message = data.choices?.[0]?.message;
  const usage = data.usage ?? {};

  if (message?.tool_calls && message.tool_calls.length > 0) {
    const toolCalls: ToolCall[] = message.tool_calls.map((tc) => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* empty args */ }
      return { id: tc.id, name: tc.function.name, args };
    });
    return { kind: 'toolCalls', preface: message.content ?? '', toolCalls, usage };
  }

  return { kind: 'message', content: message?.content ?? '', usage };
}

async function callAnthropicWithTools(
  apiKey: string,
  model: string,
  messages: ExtendedChatMessage[],
  tools: ToolDefinition[],
  options?: LlmOptions,
): Promise<RunChatToolResult> {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';

  // Anthropic expects tool_result as a user-role message with content blocks;
  // assistant tool_use blocks live inside the prior assistant message's content array.
  const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      // Coalesce consecutive tool results into a single user message with multiple blocks.
      const last = anthropicMessages[anthropicMessages.length - 1];
      const toolResultBlock = { type: 'tool_result', tool_use_id: m.callId, content: m.content };
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        (last.content as unknown[]).push(toolResultBlock);
      } else {
        anthropicMessages.push({ role: 'user', content: [toolResultBlock] });
      }
      continue;
    }
    if (m.role === 'assistant' && 'toolCalls' in m) {
      const blocks: unknown[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args });
      }
      anthropicMessages.push({ role: 'assistant', content: blocks });
      continue;
    }
    anthropicMessages.push({ role: m.role as 'user' | 'assistant', content: m.content });
  }

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
        max_tokens: options?.maxTokens ?? 1024,
        temperature: 0.2,
        messages: anthropicMessages,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      }),
    },
    AI_FETCH_TIMEOUT_MS,
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic error: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    content?: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    >;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const usage: LlmUsage = {
    prompt_tokens: data.usage?.input_tokens,
    completion_tokens: data.usage?.output_tokens,
    total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
  };

  let textPreface = '';
  const toolCalls: ToolCall[] = [];
  for (const block of data.content ?? []) {
    if (block.type === 'text') textPreface += block.text;
    else if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, args: block.input });
    }
  }

  if (toolCalls.length > 0) {
    return { kind: 'toolCalls', preface: textPreface, toolCalls, usage };
  }
  return { kind: 'message', content: textPreface, usage };
}

export async function runChatWithTools(
  provider: Provider,
  apiKey: string,
  model: string,
  messages: ExtendedChatMessage[],
  tools: ToolDefinition[],
  options?: LlmOptions & { retry?: RetryOptions },
): Promise<RunChatToolResult> {
  const call = () => {
    if (provider === 'openai') return callOpenAIWithTools(apiKey, model, messages, tools, options);
    return callAnthropicWithTools(apiKey, model, messages, tools, options);
  };
  return withRetry(call, options?.retry);
}

// ---------------------------------------------------------------------------
// Streaming provider callers
// ---------------------------------------------------------------------------

export type StreamDelta =
  | { type: 'delta'; content: string }
  | { type: 'done'; content: string; usage: LlmUsage };

function streamOpenAI(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options?: LlmOptions,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const payload: Record<string, unknown> = {
        model,
        messages,
        temperature: 0.2,
        stream: true,
      };
      if (options?.maxTokens) {
        payload.max_tokens = options.maxTokens;
      }

      let res: Response;
      try {
        res = await fetchWithTimeout(
          'https://api.openai.com/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          },
          AI_STREAM_TIMEOUT_MS,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`));
        controller.close();
        return;
      }

      if (!res.ok || !res.body) {
        const body = await res.text();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: `OpenAI error: ${res.status} ${body}` })}\n\n`));
        controller.close();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let usage: LlmUsage = {};

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
                usage?: LlmUsage;
              };
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'delta', content })}\n\n`));
              }
              if (parsed.usage) {
                usage = parsed.usage;
              }
            } catch { /* skip malformed chunks */ }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Stream read error';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`));
      }

      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', content: fullContent, usage })}\n\n`));
      controller.close();
    },
  });
}

function streamAnthropic(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options?: LlmOptions,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const userMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  return new ReadableStream({
    async start(controller) {
      let res: Response;
      try {
        res = await fetchWithTimeout(
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
              stream: true,
            }),
          },
          AI_STREAM_TIMEOUT_MS,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`));
        controller.close();
        return;
      }

      if (!res.ok || !res.body) {
        const body = await res.text();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: `Anthropic error: ${res.status} ${body}` })}\n\n`));
        controller.close();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let usage: LlmUsage = {};

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);

            try {
              const parsed = JSON.parse(data) as {
                type?: string;
                delta?: { type?: string; text?: string };
                usage?: { input_tokens?: number; output_tokens?: number };
              };

              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                const text = parsed.delta.text;
                fullContent += text;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'delta', content: text })}\n\n`));
              }

              if (parsed.type === 'message_delta' && parsed.usage) {
                usage = {
                  prompt_tokens: usage.prompt_tokens,
                  completion_tokens: parsed.usage.output_tokens,
                  total_tokens: (usage.prompt_tokens ?? 0) + (parsed.usage.output_tokens ?? 0),
                };
              }

              if (parsed.type === 'message_start') {
                const startParsed = parsed as { message?: { usage?: { input_tokens?: number } } };
                if (startParsed.message?.usage?.input_tokens) {
                  usage.prompt_tokens = startParsed.message.usage.input_tokens;
                }
              }
            } catch { /* skip malformed chunks */ }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Stream read error';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`));
      }

      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', content: fullContent, usage })}\n\n`));
      controller.close();
    },
  });
}

// ---------------------------------------------------------------------------
// Streaming public entry point
// ---------------------------------------------------------------------------

export function runChatStreaming(
  provider: Provider,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options?: LlmOptions,
): ReadableStream<Uint8Array> {
  if (provider === 'openai') return streamOpenAI(apiKey, model, messages, options);
  return streamAnthropic(apiKey, model, messages, options);
}
