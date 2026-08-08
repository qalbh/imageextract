/**
 * /api/proxy — streams exactly one image through the SSRF guard.
 *
 * This endpoint is directly reachable by anyone, so its input is untrusted
 * regardless of what /api/scan returned for the same URL.
 *
 * The size caps are two constants, deliberately asymmetric. The announced
 * cap is checked against Content-Length before streaming begins — generous,
 * because rejecting there is free. The streamed cap bounds bodies with no
 * Content-Length — tighter, because by the time it fires the 200 and
 * headers are already sent and every transferred byte is paid for; an
 * unannounced body that large is a mistake or someone using us as a pipe.
 * A body that exceeds its own announced length is aborted at the announced
 * length: the claim we vetted is the claim they must keep.
 */

import { safeFetch } from './ssrf-guard';
import { sanitizeFilename } from './extract';
import { USER_AGENT } from './scan';

export const MAX_ANNOUNCED_IMAGE_BYTES = 52_428_800; // 50 MB
export const MAX_STREAMED_IMAGE_BYTES = 20_971_520; // 20 MB
export const PROXY_TIMEOUT_MS = 30_000;

export class NotAnImageError extends Error {
  constructor(readonly contentType: string | null) {
    super('Upstream response is not an image');
    this.name = 'NotAnImageError';
  }
}

export class SizeLimitError extends Error {
  constructor(readonly limitBytes: number) {
    super(`Image exceeds the ${limitBytes}-byte limit`);
    this.name = 'SizeLimitError';
  }
}

export class UpstreamHttpError extends Error {
  constructor(readonly upstreamStatus: number) {
    super(`Upstream returned HTTP ${upstreamStatus}`);
    this.name = 'UpstreamHttpError';
  }
}

/**
 * Identity pass-through that counts bytes and errors past the cap. Erroring
 * (never terminate()) is deliberate: terminate would hand the client a
 * truncated file that looks complete. An error makes every pending and
 * future read of the client-facing stream reject, and pipeThrough cancels
 * the upstream so we stop paying for bandwidth. The contract downstream
 * code relies on: a download is complete if and only if the body stream
 * ends without error.
 */
function cappedPassthrough(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  let transferred = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        transferred += chunk.byteLength;
        if (transferred > maxBytes) {
          controller.error(new SizeLimitError(maxBytes));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

const SUFFIX_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

export function downloadFilename(url: string, normalizedContentType: string): string {
  let name = '';
  try {
    name = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
  } catch {
    // fall through to the fallback name
  }
  try {
    name = decodeURIComponent(name);
  } catch {
    // %-sequence that isn't valid UTF-8 — keep the encoded form
  }
  name = sanitizeFilename(name);
  if (name === '') name = 'image';
  if (!/\.[a-z0-9]{1,10}$/i.test(name)) {
    const suffix = SUFFIX_BY_TYPE[normalizedContentType];
    if (suffix !== undefined) name += `.${suffix}`;
  }
  return name;
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function attachmentDisposition(filename: string): string {
  // ASCII fallback in `filename`, full fidelity in RFC 5987 `filename*`.
  const ascii = filename.replace(/[^ -~]/g, '_').replace(/"/g, "'");
  const base = `attachment; filename="${ascii}"`;
  return ascii === filename ? base : `${base}; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

export interface ProxyOptions {
  selfOrigin: string;
  method?: 'GET' | 'HEAD';
  download?: boolean;
  timeoutMs?: number;
  dohCheck?: boolean;
  fetchImpl?: typeof fetch;
  dohFetchImpl?: typeof fetch;
}

/** Returns the finished proxied Response, or throws a typed error. */
export async function proxyImage(rawUrl: string, options: ProxyOptions): Promise<Response> {
  const method = options.method ?? 'GET';
  const upstream = await safeFetch(rawUrl, {
    timeoutMs: options.timeoutMs ?? PROXY_TIMEOUT_MS,
    dohCheck: options.dohCheck,
    fetchImpl: options.fetchImpl,
    dohFetchImpl: options.dohFetchImpl,
    init: { method, headers: { 'user-agent': USER_AGENT, accept: 'image/*,*/*;q=0.5' } },
  });

  if (!upstream.ok) {
    await upstream.body?.cancel();
    throw new UpstreamHttpError(upstream.status);
  }

  const rawType = upstream.headers.get('content-type');
  const contentType = (rawType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!contentType.startsWith('image/')) {
    await upstream.body?.cancel();
    throw new NotAnImageError(rawType);
  }

  const announcedHeader = upstream.headers.get('content-length');
  const announced =
    announcedHeader !== null && /^[0-9]+$/.test(announcedHeader)
      ? parseInt(announcedHeader, 10)
      : null;
  if (announced !== null && announced > MAX_ANNOUNCED_IMAGE_BYTES) {
    await upstream.body?.cancel();
    throw new SizeLimitError(MAX_ANNOUNCED_IMAGE_BYTES);
  }

  // Fresh headers only — never forward the upstream header bag (Set-Cookie
  // and friends must not pass through us).
  const headers = new Headers({
    'content-type': rawType ?? contentType,
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': options.selfOrigin,
    // `private` keeps shared caches out of the no-persistence story while
    // letting the user's browser cache repeat thumbnail hits for free.
    'cache-control': 'private, max-age=3600',
  });
  if (announced !== null) headers.set('content-length', String(announced));
  if (options.download === true) {
    const finalUrl = upstream.url !== '' ? upstream.url : rawUrl;
    headers.set('content-disposition', attachmentDisposition(downloadFilename(finalUrl, contentType)));
  }

  if (method === 'HEAD') {
    await upstream.body?.cancel();
    return new Response(null, { status: 200, headers });
  }

  const body =
    upstream.body === null
      ? null
      : cappedPassthrough(upstream.body, announced ?? MAX_STREAMED_IMAGE_BYTES);
  return new Response(body, { status: 200, headers });
}
