import type { Provider } from './llm';

export type AvailableModel = {
  id: string;
  label: string | null;
  createdAt: string | number | null;
};

const OPENAI_EXCLUDED_PREFIXES = [
  'whisper',
  'tts',
  'omni-moderation',
  'text-embedding',
  'text-moderation',
  'gpt-image',
  'dall-e'
];

const asObject = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : null);

const compareModels = (a: AvailableModel, b: AvailableModel) => {
  const aCreated = typeof a.createdAt === 'number' ? a.createdAt : Date.parse(String(a.createdAt ?? ''));
  const bCreated = typeof b.createdAt === 'number' ? b.createdAt : Date.parse(String(b.createdAt ?? ''));
  const aValue = Number.isFinite(aCreated) ? aCreated : 0;
  const bValue = Number.isFinite(bCreated) ? bCreated : 0;
  if (aValue !== bValue) return bValue - aValue;
  return a.id.localeCompare(b.id);
};

export const isLikelyOpenAiTextModel = (modelId: string) => {
  const id = modelId.toLowerCase();
  if (!id) return false;
  if (OPENAI_EXCLUDED_PREFIXES.some((prefix) => id.startsWith(prefix))) return false;
  if (id.startsWith('gpt-') || id.startsWith('chatgpt-')) return true;
  if (/^o\d/.test(id) || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')) return true;
  return id.includes('gpt');
};

export const normalizeOpenAiModels = (rawItems: unknown[]): AvailableModel[] => {
  const dedupe = new Map<string, AvailableModel>();

  for (const item of rawItems) {
    const obj = asObject(item);
    const id = typeof obj?.id === 'string' ? obj.id.trim() : '';
    if (!id || !isLikelyOpenAiTextModel(id)) continue;
    const createdAt = typeof obj?.created === 'number' ? obj.created : null;
    if (!dedupe.has(id)) {
      dedupe.set(id, { id, label: null, createdAt });
    }
  }

  return [...dedupe.values()].sort(compareModels);
};

export const normalizeAnthropicModels = (rawItems: unknown[]): AvailableModel[] => {
  const dedupe = new Map<string, AvailableModel>();

  for (const item of rawItems) {
    const obj = asObject(item);
    const id = typeof obj?.id === 'string' ? obj.id.trim() : '';
    if (!id || !id.toLowerCase().startsWith('claude')) continue;
    const label = typeof obj?.display_name === 'string' ? obj.display_name : null;
    const createdAt = typeof obj?.created_at === 'string' ? obj.created_at : null;
    if (!dedupe.has(id)) {
      dedupe.set(id, { id, label, createdAt });
    }
  }

  return [...dedupe.values()].sort(compareModels);
};

const parseJson = async (res: Response) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const getErrorText = async (res: Response, fallback: string) => {
  try {
    const text = await res.text();
    return text ? `${fallback}: ${res.status} ${text}` : `${fallback}: ${res.status}`;
  } catch {
    return `${fallback}: ${res.status}`;
  }
};

const listOpenAiModels = async (apiKey: string) => {
  const res = await fetch('https://api.openai.com/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!res.ok) {
    throw new Error(await getErrorText(res, 'OpenAI model listing failed'));
  }

  const payload = await parseJson(res);
  const data = Array.isArray(asObject(payload)?.data) ? (asObject(payload)?.data as unknown[]) : [];
  return normalizeOpenAiModels(data);
};

const listAnthropicModels = async (apiKey: string) => {
  const collected: unknown[] = [];
  let afterId: string | null = null;

  for (let page = 0; page < 5; page += 1) {
    const endpoint = new URL('https://api.anthropic.com/v1/models');
    endpoint.searchParams.set('limit', '100');
    if (afterId) endpoint.searchParams.set('after_id', afterId);

    const res = await fetch(endpoint.toString(), {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    });
    if (!res.ok) {
      throw new Error(await getErrorText(res, 'Anthropic model listing failed'));
    }

    const payload = asObject(await parseJson(res));
    const data = Array.isArray(payload?.data) ? (payload.data as unknown[]) : [];
    collected.push(...data);

    const hasMore = Boolean(payload?.has_more);
    const lastId = typeof payload?.last_id === 'string' ? payload.last_id : null;
    if (!hasMore || !lastId) break;
    afterId = lastId;
  }

  return normalizeAnthropicModels(collected);
};

export async function listProviderModels(provider: Provider, apiKey: string) {
  if (provider === 'openai') return listOpenAiModels(apiKey);
  return listAnthropicModels(apiKey);
}
