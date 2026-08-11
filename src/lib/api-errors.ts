/**
 * One error→response mapping shared by both endpoints, so a typed error
 * means the same status and wording everywhere. Unknown errors are
 * rethrown on purpose: a genuine bug should surface as a raw 500, not
 * hide behind a friendly catch-all.
 */

import {
  BlockedHostError,
  TimeoutError,
  TooManyRedirectsError,
  UpstreamNetworkError,
  type RejectionReason,
} from './ssrf-guard';
import { NotAnImageError, SizeLimitError, UpstreamHttpError } from './proxy';

export function json(status: number, body: unknown): Response {
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
  // Honest about both populations on the list (owner requests AND abuse
  // blocks), and deliberately distinguishable from the robots message.
  'domain-blocked': {
    status: 403,
    message: "This site is excluded from this tool — at its owner's request, or for abuse prevention.",
  },
  'dns-nxdomain': {
    status: 404,
    message: "We couldn't find that domain — check the URL and try again.",
  },
  'dns-error': {
    status: 502,
    message: "We couldn't verify that domain right now. Please try again shortly.",
  },
};

// The 429 copy must not accuse: shared egress (carrier-NAT, campus Wi-Fi)
// means many users sit behind one counter, so the person reading this may
// have done nothing heavy. Say what was exceeded, that the allowance is
// shared per network connection, and when it resets. Never "you".
const RATE_LIMIT_COPY: Record<'scan' | 'proxy', (minutes: number) => string> = {
  scan: (m) =>
    'This tool allows 30 page scans per hour for each network connection, and the ' +
    'allowance is shared — on mobile networks and shared Wi-Fi, many people can count ' +
    `against the same connection. The limit resets within the hour; try again in about ${m} minute${m === 1 ? '' : 's'}.`,
  proxy: (m) =>
    'The hourly image limit (1,000 image requests per network connection) was reached. ' +
    'The allowance is shared by everyone on your network connection, and resets within ' +
    `the hour — try again in about ${m} minute${m === 1 ? '' : 's'}.`,
};

export function rateLimitResponse(kind: 'scan' | 'proxy', retryAfterSeconds: number): Response {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return new Response(
    JSON.stringify({
      error: 'rate-limited',
      message: RATE_LIMIT_COPY[kind](minutes),
      retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'retry-after': String(retryAfterSeconds),
      },
    },
  );
}

export function errorResponse(err: unknown): Response {
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
  if (err instanceof NotAnImageError) {
    return json(415, { error: 'not-an-image', message: "That URL doesn't point to an image." });
  }
  if (err instanceof SizeLimitError) {
    return json(413, { error: 'size-limit', message: 'This image is larger than the size limit.' });
  }
  if (err instanceof UpstreamHttpError) {
    return json(502, {
      error: 'upstream-error',
      upstreamStatus: err.upstreamStatus,
      message: "The image's server responded with an error.",
    });
  }
  if (err instanceof UpstreamNetworkError) {
    return json(502, {
      error: 'upstream-network',
      message: "That server couldn't be reached — it may be down or refusing connections.",
    });
  }
  // Rethrown on purpose: a genuine bug should surface as a raw 500, not
  // hide behind a friendly catch-all. The uncaught message lands in
  // platform logs, and that is safe ONLY because message hygiene is a
  // RUNTIME property, not a code property: workerd genericizes error text
  // (measured 2026-08-10 in the workerd pool — "TypeError: Invalid URL
  // string.", "Error: Network connection lost.", "Error: internal error;
  // reference = ..."). The same rethrow on Node would log
  // "Invalid URL: <the user's URL>". If this code ever runs outside
  // workerd, this line is where the no-URLs-in-logs constraint breaks.
  throw err;
}
