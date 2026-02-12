import { json } from '@sveltejs/kit';
import { dbAll } from '$lib/server/db';
import { getChatProviderModel, getIngestProviderModel, getSetting, setSetting } from '$lib/server/settings';

export const GET = async ({ platform }) => {
  const db = platform.env.DB;
  const ingestModel = await getIngestProviderModel(db, platform.env);
  const chatModel = await getChatProviderModel(db, platform.env);
  const settings = {
    ingestProvider: ingestModel.provider,
    ingestModel: ingestModel.model,
    ingestReasoningEffort: ingestModel.reasoningEffort,
    chatProvider: chatModel.provider,
    chatModel: chatModel.model,
    chatReasoningEffort: chatModel.reasoningEffort,
    summaryStyle: (await getSetting(db, 'summary_style')) ?? 'concise',
    summaryLength: (await getSetting(db, 'summary_length')) ?? 'short',
    pollInterval: (await getSetting(db, 'poll_interval')) ?? '60'
  };

  const keys = await dbAll<{ provider: string }>(db, 'SELECT provider FROM provider_keys');
  const keyMap = { openai: false, anthropic: false };
  for (const key of keys) {
    if (key.provider in keyMap) keyMap[key.provider as 'openai' | 'anthropic'] = true;
  }

  return json({ settings, keys: keyMap });
};

export const POST = async ({ request, platform }) => {
  const body = await request.json();
  const entries: [string, string][] = [];
  const validProviders = new Set(['openai', 'anthropic']);
  const validEfforts = new Set(['minimal', 'low', 'medium', 'high']);

  if (body?.ingestProvider && validProviders.has(body.ingestProvider)) {
    entries.push(['ingest_provider', body.ingestProvider]);
  }
  if (body?.ingestModel && String(body.ingestModel).trim()) {
    entries.push(['ingest_model', String(body.ingestModel).trim()]);
  }
  if (body?.ingestReasoningEffort && validEfforts.has(body.ingestReasoningEffort)) {
    entries.push(['ingest_reasoning_effort', body.ingestReasoningEffort]);
  }

  if (body?.chatProvider && validProviders.has(body.chatProvider)) {
    entries.push(['chat_provider', body.chatProvider]);
  }
  if (body?.chatModel && String(body.chatModel).trim()) {
    entries.push(['chat_model', String(body.chatModel).trim()]);
  }
  if (body?.chatReasoningEffort && validEfforts.has(body.chatReasoningEffort)) {
    entries.push(['chat_reasoning_effort', body.chatReasoningEffort]);
  }

  // Backward-compatible keys used by earlier builds.
  if (body?.defaultProvider && validProviders.has(body.defaultProvider)) {
    entries.push(['default_provider', body.defaultProvider]);
  }
  if (body?.defaultModel && String(body.defaultModel).trim()) {
    entries.push(['default_model', String(body.defaultModel).trim()]);
  }
  if (body?.reasoningEffort && validEfforts.has(body.reasoningEffort)) {
    entries.push(['reasoning_effort', body.reasoningEffort]);
  }

  if (body?.summaryStyle) entries.push(['summary_style', body.summaryStyle]);
  if (body?.summaryLength) entries.push(['summary_length', body.summaryLength]);
  if (body?.pollInterval) entries.push(['poll_interval', String(body.pollInterval)]);

  for (const [key, value] of entries) {
    await setSetting(platform.env.DB, key, value);
  }

  return json({ ok: true });
};
