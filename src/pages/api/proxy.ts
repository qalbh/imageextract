import type { APIRoute } from 'astro';
import { z } from 'zod';
import { errorResponse, json } from '../../lib/api-errors';
import { proxyImage } from '../../lib/proxy';

export const prerender = false;

const querySchema = z.object({ url: z.string().min(1).max(4096) });

function handler(method: 'GET' | 'HEAD'): APIRoute {
  return async ({ url }) => {
    const parsed = querySchema.safeParse({ url: url.searchParams.get('url') ?? '' });
    if (!parsed.success) {
      return json(400, { error: 'invalid-request', message: 'Provide a url query parameter.' });
    }
    try {
      return await proxyImage(parsed.data.url, {
        method,
        download: url.searchParams.get('download') === '1',
        selfOrigin: url.origin,
      });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export const GET = handler('GET');
export const HEAD = handler('HEAD');
