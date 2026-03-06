import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

describe('/authorize alias route', () => {
  it('redirects to /oauth/authorize preserving the query string', async () => {
    await expect(
      load({
        url: new URL(
          'https://mcp.example.com/authorize?client_id=client-123&response_type=code&state=abc'
        )
      } as Parameters<typeof load>[0])
    ).rejects.toMatchObject({
      status: 307,
      location:
        'https://mcp.example.com/oauth/authorize?client_id=client-123&response_type=code&state=abc'
    });
  });
});
