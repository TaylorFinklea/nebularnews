import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleOAuthConsentResult } from './oauth-consent';

const applyActionMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('$app/forms', () => ({
  applyAction: applyActionMock
}));

describe('handleOAuthConsentResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates directly for redirect results', async () => {
    const navigateMock = vi.fn();

    await handleOAuthConsentResult(
      { type: 'redirect', location: 'https://chatgpt.com/connector/oauth/callback?code=abc' },
      navigateMock
    );

    expect(navigateMock).toHaveBeenCalledWith('https://chatgpt.com/connector/oauth/callback?code=abc');
    expect(applyActionMock).not.toHaveBeenCalled();
  });

  it('applies non-redirect action results normally', async () => {
    const result = { type: 'failure', status: 400, data: { error: 'Invalid request' } };

    await handleOAuthConsentResult(result);

    expect(applyActionMock).toHaveBeenCalledWith(result);
  });
});
