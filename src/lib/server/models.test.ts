import { describe, expect, it } from 'vitest';
import { isLikelyOpenAiTextModel, normalizeAnthropicModels, normalizeOpenAiModels } from './models';

describe('isLikelyOpenAiTextModel', () => {
  it('accepts chat models', () => {
    expect(isLikelyOpenAiTextModel('gpt-5-mini')).toBe(true);
    expect(isLikelyOpenAiTextModel('gpt-5.2')).toBe(true);
    expect(isLikelyOpenAiTextModel('o4-mini')).toBe(true);
  });

  it('rejects non-chat models', () => {
    expect(isLikelyOpenAiTextModel('text-embedding-3-large')).toBe(false);
    expect(isLikelyOpenAiTextModel('omni-moderation-latest')).toBe(false);
    expect(isLikelyOpenAiTextModel('whisper-1')).toBe(false);
  });
});

describe('normalizeOpenAiModels', () => {
  it('filters and de-duplicates model ids', () => {
    const models = normalizeOpenAiModels([
      { id: 'gpt-5-mini', created: 20 },
      { id: 'gpt-5-mini', created: 21 },
      { id: 'text-embedding-3-large', created: 100 },
      { id: 'o4-mini', created: 10 }
    ]);

    expect(models.map((model) => model.id)).toEqual(['gpt-5-mini', 'o4-mini']);
  });
});

describe('normalizeAnthropicModels', () => {
  it('keeps claude models sorted by created_at', () => {
    const models = normalizeAnthropicModels([
      { id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5', created_at: '2026-01-01T00:00:00Z' },
      { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', created_at: '2025-01-01T00:00:00Z' },
      { id: 'foo-model', display_name: 'Foo', created_at: '2027-01-01T00:00:00Z' }
    ]);

    expect(models.map((model) => model.id)).toEqual(['claude-sonnet-4-5', 'claude-haiku-4-5']);
  });
});
