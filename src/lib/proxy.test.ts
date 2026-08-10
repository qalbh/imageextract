import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDohCache } from './ssrf-guard';
import {
  MAX_ANNOUNCED_IMAGE_BYTES,
  MAX_STREAMED_IMAGE_BYTES,
  NotAnImageError,
  SizeLimitError,
  downloadFilename,
  proxyImage,
} from './proxy';
import { GET, HEAD } from '../pages/api/proxy';

beforeEach(() => clearDohCache());

const ORIGIN = 'https://ours.example';
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

type Upstream = {
  status?: number;
  headers?: Record<string, string>;
  body?: Uint8Array | ReadableStream<Uint8Array> | null;
};

function upstreamFetch(routes: Record<string, Upstream | { location: string }>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const route = routes[String(input)];
    if (!route) throw new Error('fetch reached a URL the test did not map');
    if ('location' in route) {
      return new Response(null, { status: 302, headers: { location: route.location } });
    }
    const body =
      init?.method === 'HEAD'
        ? null
        : route.body instanceof Uint8Array
          ? new Blob([route.body as BlobPart]).stream()
          : (route.body ?? null);
    const response = new Response(body, { status: route.status ?? 200, headers: route.headers });
    // Real fetch sets response.url to the final URL; constructed Responses
    // leave it '' — shadow the prototype getter so the mock is faithful.
    Object.defineProperty(response, 'url', { value: String(input) });
    return response;
  });
}

function image(rawUrl: string, routes: Record<string, Upstream | { location: string }>, extra?: Partial<Parameters<typeof proxyImage>[1]>) {
  return proxyImage(rawUrl, {
    selfOrigin: ORIGIN,
    dohCheck: false,
    fetchImpl: upstreamFetch(routes) as unknown as typeof fetch,
    ...extra,
  });
}

/** An endless unannounced body that records whether it got cancelled. */
function endlessBody(): { stream: ReadableStream<Uint8Array>; cancelled: () => boolean } {
  let cancelled = false;
  const chunk = new Uint8Array(65_536);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

describe('proxyImage', () => {
  it('streams an image through byte-identical with our headers', async () => {
    const response = await image('https://site.example/cat.png', {
      'https://site.example/cat.png': {
        headers: { 'content-type': 'image/png', 'content-length': String(PNG_BYTES.length) },
        body: PNG_BYTES,
      },
    });
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe(String(PNG_BYTES.length));
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(response.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(response.headers.get('content-disposition')).toBeNull();
  });

  it('rejects non-image content types', async () => {
    await expect(
      image('https://site.example/page', {
        'https://site.example/page': {
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: new TextEncoder().encode('<html>not an image</html>'),
        },
      }),
    ).rejects.toBeInstanceOf(NotAnImageError);
  });

  it('rejects a missing content type', async () => {
    await expect(
      image('https://site.example/mystery', {
        'https://site.example/mystery': { headers: {}, body: PNG_BYTES },
      }),
    ).rejects.toBeInstanceOf(NotAnImageError);
  });

  it('rejects an announced oversize body without reading it', async () => {
    const { stream, cancelled } = endlessBody();
    await expect(
      image('https://site.example/huge.png', {
        'https://site.example/huge.png': {
          headers: {
            'content-type': 'image/png',
            'content-length': String(MAX_ANNOUNCED_IMAGE_BYTES + 1),
          },
          body: stream,
        },
      }),
    ).rejects.toBeInstanceOf(SizeLimitError);
    expect(cancelled()).toBe(true);
  });

  it('aborts an unannounced body mid-stream past the streamed cap and cancels upstream', async () => {
    const { stream, cancelled } = endlessBody();
    const response = await image('https://site.example/endless.png', {
      'https://site.example/endless.png': {
        headers: { 'content-type': 'image/png' },
        body: stream,
      },
    });
    // Headers are already committed — the failure is observable only as an
    // errored body stream, never a clean close.
    expect(response.status).toBe(200);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    let transferred = 0;
    await expect(
      (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          transferred += value?.byteLength ?? 0;
        }
      })(),
    ).rejects.toBeInstanceOf(SizeLimitError);
    expect(transferred).toBeLessThanOrEqual(MAX_STREAMED_IMAGE_BYTES);
    expect(cancelled()).toBe(true);
  });

  it('aborts a body that exceeds its own announced length', async () => {
    const { stream } = endlessBody();
    const response = await image('https://site.example/liar.png', {
      'https://site.example/liar.png': {
        headers: { 'content-type': 'image/png', 'content-length': '1000' },
        body: stream,
      },
    });
    await expect(response.arrayBuffer()).rejects.toBeInstanceOf(SizeLimitError);
  });

  it('rejects a redirect into a private IP without fetching it', async () => {
    const fetchImpl = upstreamFetch({
      'https://site.example/img.png': { location: 'http://10.0.0.5/internal.png' },
    });
    await expect(
      proxyImage('https://site.example/img.png', {
        selfOrigin: ORIGIN,
        dohCheck: false,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ name: 'BlockedHostError', reason: 'private-ip' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('surfaces a non-2xx upstream as UpstreamHttpError', async () => {
    await expect(
      image('https://site.example/gone.png', {
        'https://site.example/gone.png': {
          status: 404,
          headers: { 'content-type': 'text/html' },
          body: new TextEncoder().encode('nope'),
        },
      }),
    ).rejects.toMatchObject({ name: 'UpstreamHttpError', upstreamStatus: 404 });
  });

  it('sets Content-Disposition only with download, using the final redirect URL', async () => {
    const routes: Record<string, Upstream | { location: string }> = {
      'https://site.example/old-path.png': { location: 'https://cdn.example/photos/new name.png' },
      // the Location's literal space is %-encoded by URL normalization
      'https://cdn.example/photos/new%20name.png': {
        headers: { 'content-type': 'image/png' },
        body: PNG_BYTES,
      },
    };
    const response = await image('https://site.example/old-path.png', routes, { download: true });
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="new name.png"');
  });

  it('non-ASCII filenames get an RFC 5987 filename* plus an ASCII fallback', async () => {
    const response = await image(
      'https://site.example/caf%C3%A9.png',
      {
        'https://site.example/caf%C3%A9.png': {
          headers: { 'content-type': 'image/png' },
          body: PNG_BYTES,
        },
      },
      { download: true },
    );
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="caf_.png"; filename*=UTF-8''caf%C3%A9.png`,
    );
  });

  it('HEAD returns headers and no body', async () => {
    const fetchImpl = upstreamFetch({
      'https://site.example/cat.png': {
        headers: { 'content-type': 'image/png', 'content-length': '12345' },
      },
    });
    const response = await proxyImage('https://site.example/cat.png', {
      selfOrigin: ORIGIN,
      method: 'HEAD',
      dohCheck: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(response.body).toBeNull();
    expect(response.headers.get('content-length')).toBe('12345');
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('HEAD');
  });

  it('forwards a client Range upstream and passes 206 + Content-Range back', async () => {
    const fetchImpl = upstreamFetch({
      'https://site.example/big.jpg': {
        status: 206,
        headers: {
          'content-type': 'image/jpeg',
          'content-length': '4096',
          'content-range': 'bytes 0-4095/9876543',
        },
        body: PNG_BYTES,
      },
    });
    const response = await proxyImage('https://site.example/big.jpg', {
      selfOrigin: ORIGIN,
      range: 'bytes=0-4095',
      dohCheck: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('range')).toBe('bytes=0-4095');
    // The 200-over-206 bug: the status used to be hard-coded 200, labelling a
    // partial body as a complete resource. A 206 is now a 206.
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-4095/9876543');
  });

  it('a full 200 stays 200 with no content-range and no range header sent', async () => {
    const fetchImpl = upstreamFetch({
      'https://site.example/cat.png': {
        headers: { 'content-type': 'image/png', 'content-length': '11' },
        body: PNG_BYTES,
      },
    });
    const response = await proxyImage('https://site.example/cat.png', {
      selfOrigin: ORIGIN,
      dohCheck: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('range')).toBeNull();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-range')).toBeNull();
  });

  it('cancelling the proxied body cancels the UPSTREAM stream (a probe stays kilobytes)', async () => {
    // The range-ignored-origin path: a 200 with an endless body. The client
    // reads a prefix and cancels; that cancellation must PROPAGATE to the
    // upstream fetch or a 4 KB probe silently becomes a full transfer.
    const upstream = endlessBody();
    const response = await image('https://site.example/endless.png', {
      'https://site.example/endless.png': {
        headers: { 'content-type': 'image/png' },
        body: upstream.stream,
      },
    });
    const reader = response.body!.getReader();
    await reader.read(); // take one chunk, like the probe does
    await reader.cancel();
    // Cancellation crosses the passthrough asynchronously.
    await new Promise((r) => setTimeout(r, 10));
    expect(upstream.cancelled()).toBe(true);
  });
});

describe('downloadFilename', () => {
  it('sanitizes and falls back sensibly', () => {
    expect(downloadFilename('https://x.example/a/b/photo.jpg?v=2', 'image/jpeg')).toBe('photo.jpg');
    expect(downloadFilename('https://x.example/pics/cat%20photo.png', 'image/png')).toBe('cat photo.png');
    // leading dots stripped, encoded separators neutralized
    expect(downloadFilename('https://x.example/.hidden.png', 'image/png')).toBe('hidden.png');
    expect(downloadFilename('https://x.example/a%2Fb.png', 'image/png')).toBe('a-b.png');
    expect(downloadFilename('https://x.example/', 'image/webp')).toBe('image.webp');
    expect(downloadFilename('https://x.example/photo', 'image/jpeg')).toBe('photo.jpg');
    const long = downloadFilename(`https://x.example/${'a'.repeat(200)}.png`, 'image/png');
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('.png')).toBe(true);
  });

  it('control characters and separators are stripped', () => {
    expect(downloadFilename('https://x.example/we%00ird%0aname.gif', 'image/gif')).toBe('weirdname.gif');
  });
});

describe('/api/proxy endpoint', () => {
  const call = (route: typeof GET, query: string): Promise<Response> =>
    Promise.resolve(
      route({ url: new URL(`${ORIGIN}/api/proxy${query}`) } as Parameters<typeof GET>[0]),
    );

  it('400s without a url parameter', async () => {
    const response = await call(GET, '');
    expect(response.status).toBe(400);
  });

  it('maps guard rejections before any fetch', async () => {
    const response = await call(GET, '?url=http%3A%2F%2F169.254.169.254%2Flatest');
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('private-ip');
  });

  it('HEAD export also guards', async () => {
    const response = await call(HEAD, '?url=http%3A%2F%2Flocalhost%2Fx');
    expect(response.status).toBe(403);
  });
});
