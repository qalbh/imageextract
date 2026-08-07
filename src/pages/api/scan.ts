import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  BlockedHostError,
  TimeoutError,
  TooManyRedirectsError,
  type RejectionReason,
} from '../../lib/ssrf-guard';
import { scanPage } from '../../lib/scan';

export const prerender = false;

const querySchema = z.object({ url: z.string().min(1).max(4096) });

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

const REASON_RESPONSES: Record<RejectionReason, { status: number; message: string }> = {
  'invalid-url': { status: 400, message: "That doesn't look like a valid web address." },
  'bad-scheme': { status: 400, message: 'Only http and https pages can be scanned.' },
  'bad-port': { status: 400, message: "Pages on non-standard ports can't be scanned." },
  'private-ip': { status: 403, message: "That address isn't reachable from the public internet." },
  'blocked-hostname': {
    status: 403,
    message: "That address isn't reachable from the public internet.",
  },
  'dns-private': { status: 403, message: "That address isn't reachable from the public internet." },
  'dns-nxdomain': {
    status: 404,
    message: "We couldn't find that domain — check the URL and try again.",
  },
  'dns-error': {
    status: 502,
    message: "We couldn't verify that domain right now. Please try again shortly.",
  },
};

export const GET: APIRoute = async ({ url }) => {
  const parsed = querySchema.safeParse({ url: url.searchParams.get('url') ?? '' });
  if (!parsed.success) {
    return json(400, { error: 'invalid-request', message: 'Provide a url query parameter.' });
  }
  try {
    return json(200, await scanPage(parsed.data.url));
  } catch (err) {
    if (err instanceof BlockedHostError) {
      const mapped = REASON_RESPONSES[err.reason];
      return json(mapped.status, { error: err.reason, message: mapped.message });
    }
    if (err instanceof TooManyRedirectsError) {
      return json(502, { error: 'too-many-redirects', message: 'The page redirected too many times.' });
    }
    if (err instanceof TimeoutError) {
      return json(504, { error: 'timeout', message: 'The page took too long to respond.' });
    }
    // A genuine bug should surface as a 500, not hide behind a friendly
    // catch-all.
    throw err;
  }
};
