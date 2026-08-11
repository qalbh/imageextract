import type { APIRoute } from 'astro';
import { z } from 'zod';
import { errorResponse, json, rateLimitResponse } from '../../lib/api-errors';
import { checkRateLimit } from '../../lib/rate-limit';
import { proxyImage } from '../../lib/proxy';
import { blocklistBinding } from '../../lib/blocklist';

export const prerender = false;

const querySchema = z.object({ url: z.string().min(1).max(4096) });

function handler(method: 'GET' | 'HEAD'): APIRoute {
  return async ({ url, request }) => {
    // Parse → rate check → work; HEAD counts like GET (it spends the same
    // subrequest). See the scan route for the ordering and canary notes.
    const parsed = querySchema.safeParse({ url: url.searchParams.get('url') ?? '' });
    if (!parsed.success) {
      return json(400, { error: 'invalid-request', message: 'Provide a url query parameter.' });
    }
    const ip = request?.headers.get('cf-connecting-ip') ?? null;
    const verdict = checkRateLimit('proxy', ip, Date.now());
    if (!verdict.ok) return rateLimitResponse('proxy', verdict.retryAfterSeconds);
    // See the scan route for the canary rationale.
    const respond = (res: Response): Response => {
      if (ip === null) res.headers.set('x-rate-limit', 'unenforced');
      return res;
    };
    try {
      return respond(
        await proxyImage(parsed.data.url, {
          method,
          download: url.searchParams.get('download') === '1',
          range: request?.headers.get('range') ?? null,
          selfOrigin: url.origin,
          blocklist: blocklistBinding(),
        }),
      );
    } catch (err) {
      return respond(errorResponse(err));
    }
  };
}

export const GET = handler('GET');
export const HEAD = handler('HEAD');
