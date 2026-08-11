import type { APIRoute } from 'astro';
import { z } from 'zod';
import { errorResponse, json, rateLimitResponse } from '../../lib/api-errors';
import { checkRateLimit } from '../../lib/rate-limit';
import { scanPage } from '../../lib/scan';
import { blocklistBinding } from '../../lib/blocklist';

export const prerender = false;

const querySchema = z.object({ url: z.string().min(1).max(4096) });

export const GET: APIRoute = async ({ url, request }) => {
  // Parse first (cheap, no subrequests), THEN the rate check, then work —
  // malformed requests never spend budget; guard-rejected ones do (they
  // are real inbound requests).
  const parsed = querySchema.safeParse({ url: url.searchParams.get('url') ?? '' });
  if (!parsed.success) {
    return json(400, { error: 'invalid-request', message: 'Provide a url query parameter.' });
  }
  const ip = request?.headers.get('cf-connecting-ip') ?? null;
  const verdict = checkRateLimit('scan', ip, Date.now());
  if (!verdict.ok) return rateLimitResponse('scan', verdict.retryAfterSeconds);
  // Anomaly canary, not a log line: in production the edge always sets
  // CF-Connecting-IP, so its absence means limiting is silently off. A
  // static header on every response makes that observable to an
  // operator's curl without logging anything.
  const respond = (res: Response): Response => {
    if (ip === null) res.headers.set('x-rate-limit', 'unenforced');
    return res;
  };
  try {
    return respond(
      json(200, await scanPage(parsed.data.url, { blocklist: blocklistBinding() })),
    );
  } catch (err) {
    return respond(errorResponse(err));
  }
};
