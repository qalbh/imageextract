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
  'dns-nxdomain': {
    status: 404,
    message: "We couldn't find that domain — check the URL and try again.",
  },
  'dns-error': {
    status: 502,
    message: "We couldn't verify that domain right now. Please try again shortly.",
  },
};

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
  throw err;
}
