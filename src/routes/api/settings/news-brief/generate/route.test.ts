import { beforeEach, describe, expect, it, vi } from 'vitest';

const createManualNewsBriefEditionMock = vi.hoisted(() => vi.fn());
const processNewsBriefEditionByIdMock = vi.hoisted(() => vi.fn());
const resolveNewsBriefGenerationContextMock = vi.hoisted(() => vi.fn());
const recordAuditEventMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('$lib/server/news-brief', () => ({
  createManualNewsBriefEdition: createManualNewsBriefEditionMock,
  processNewsBriefEditionById: processNewsBriefEditionByIdMock,
  resolveNewsBriefGenerationContext: resolveNewsBriefGenerationContextMock
}));

vi.mock('$lib/server/audit', () => ({
  recordAuditEvent: recordAuditEventMock
}));

import { POST } from './+server';

const createEvent = () =>
  ({
    locals: {
      db: {} as any,
      requestId: 'req-1',
      user: { id: 'admin' },
      env: {}
    }
  }) as Parameters<typeof POST>[0];

describe('/api/settings/news-brief/generate POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveNewsBriefGenerationContextMock.mockResolvedValue({
      config: {
        enabled: true,
        timezone: 'America/Chicago',
        morningTime: '08:00',
        eveningTime: '17:00',
        lookbackHours: 48,
        scoreCutoff: 3
      },
      provider: 'openai',
      model: 'gpt-4o',
      reasoningEffort: 'medium',
      apiKey: 'test-key'
    });
    createManualNewsBriefEditionMock.mockResolvedValue('edition-1');
    processNewsBriefEditionByIdMock.mockResolvedValue({
      id: 'edition-1',
      status: 'ready',
      generated_at: 1234,
      candidate_count: 6
    });
  });

  it('returns 400 when no provider key is configured', async () => {
    resolveNewsBriefGenerationContextMock.mockResolvedValueOnce({
      config: {
        enabled: true,
        timezone: 'America/Chicago',
        morningTime: '08:00',
        eveningTime: '17:00',
        lookbackHours: 48,
        scoreCutoff: 3
      },
      provider: 'openai',
      model: 'gpt-4o',
      reasoningEffort: 'medium',
      apiKey: null
    });

    const response = await POST(createEvent());

    expect(response.status).toBe(400);
    expect(createManualNewsBriefEditionMock).not.toHaveBeenCalled();
  });

  it('generates a manual edition immediately', async () => {
    const response = await POST(createEvent());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(createManualNewsBriefEditionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timezone: 'America/Chicago' }),
      undefined,
      'admin'
    );
    expect(processNewsBriefEditionByIdMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'edition-1',
      { skipClaim: true }
    );
    expect(payload).toEqual({
      ok: true,
      edition: {
        id: 'edition-1',
        status: 'ready',
        generatedAt: 1234,
        candidateCount: 6
      }
    });
  });
});
