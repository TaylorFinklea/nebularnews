import { apiOk } from '$lib/server/api';

export const GET = async (event) =>
  apiOk(event, {
    status: 'ok',
    service: 'nebular-news',
    timestamp: Date.now()
  });

