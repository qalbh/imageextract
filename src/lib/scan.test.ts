import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDohCache } from './ssrf-guard';
import { scanPage } from './scan';
import { GET } from '../pages/api/scan';

beforeEach(() => clearDohCache());

type Route = { status?: number; body?: string; headers?: Record<string, string> };

function routedFetch(routes: Record<string, Route>) {
  return vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const key = String(input);
    const route = routes[key];
    if (!route) throw new Error('fetch reached a URL the test did not map');
    return new Response(route.body ?? '', { status: route.status ?? 200, headers: route.headers });
  });
}

const deps = (routes: Record<string, Route>) => ({
  fetchImpl: routedFetch(routes) as unknown as typeof fetch,
  dohCheck: false,
});

describe('scanPage', () => {
  it('returns a manifest for a normal page', async () => {
    const result = await scanPage(
      'https://site.example/gallery',
      deps({
        'https://site.example/robots.txt': { status: 404 },
        'https://site.example/gallery': {
          body: '<html><body><img src="/a.png"><img src="b.jpg"></body></html>',
        },
      }),
    );
    expect(result.robotsBlocked).toBeUndefined();
    expect(result.pageUrl).toBe('https://site.example/gallery');
    expect(result.truncated).toBeUndefined();
    expect('truncated' in result).toBe(false);
    expect(result.images.map((i) => i.url)).toEqual([
      'https://site.example/a.png',
      // relative b.jpg resolves as a sibling of /gallery (no trailing slash)
      'https://site.example/b.jpg',
    ]);
  });

  it('returns robotsBlocked when our agent is disallowed, without fetching the page', async () => {
    const fetchImpl = routedFetch({
      'https://site.example/robots.txt': { body: 'User-agent: *\nDisallow: /private/' },
    });
    const result = await scanPage('https://site.example/private/album', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      dohCheck: false,
    });
    expect(result).toEqual({
      pageUrl: 'https://site.example/private/album',
      images: [],
      robotsBlocked: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('scans when robots.txt disallows a different path', async () => {
    const result = await scanPage(
      'https://site.example/public/album',
      deps({
        'https://site.example/robots.txt': { body: 'User-agent: *\nDisallow: /private/' },
        'https://site.example/public/album': { body: '<img src="/ok.png">' },
      }),
    );
    expect(result.robotsBlocked).toBeUndefined();
    expect(result.images).toHaveLength(1);
  });

  it('treats an unreachable robots.txt as no rules', async () => {
    const result = await scanPage(
      'https://site.example/page',
      deps({
        'https://site.example/robots.txt': { status: 500 },
        'https://site.example/page': { body: '<img src="/ok.png">' },
      }),
    );
    expect(result.images).toHaveLength(1);
  });

  it('parses a non-2xx page like any other', async () => {
    const result = await scanPage(
      'https://site.example/gone',
      deps({
        'https://site.example/robots.txt': { status: 404 },
        'https://site.example/gone': { status: 404, body: '<img src="/sad-404.png">' },
      }),
    );
    expect(result.images.map((i) => i.url)).toEqual(['https://site.example/sad-404.png']);
  });

  it('fetches linked stylesheets and resolves their urls against the sheet URL', async () => {
    const result = await scanPage(
      'https://site.example/page',
      deps({
        'https://site.example/robots.txt': { status: 404 },
        'https://site.example/page': {
          body: '<link rel="stylesheet" href="https://cdn.example/styles/main.css"><img src="/inline.png">',
        },
        'https://cdn.example/styles/main.css': {
          body: '.hero{background:url(../img/hero.jpg)}',
        },
      }),
    );
    expect(result.images.map((i) => i.url)).toEqual([
      'https://site.example/inline.png',
      'https://cdn.example/img/hero.jpg',
    ]);
    expect(result.images.find((i) => i.url.includes('hero'))?.source).toBe('stylesheet');
  });

  it('a failing stylesheet degrades the manifest instead of failing the scan', async () => {
    const result = await scanPage(
      'https://site.example/page',
      deps({
        'https://site.example/robots.txt': { status: 404 },
        'https://site.example/page': {
          body: '<link rel="stylesheet" href="/broken.css"><img src="/ok.png">',
        },
        'https://site.example/broken.css': { status: 500 },
      }),
    );
    expect(result.images.map((i) => i.url)).toEqual(['https://site.example/ok.png']);
  });

  it('skips a stylesheet pointing at a blocked host', async () => {
    const fetchImpl = routedFetch({
      'https://site.example/robots.txt': { status: 404 },
      'https://site.example/page': {
        body: '<link rel="stylesheet" href="http://169.254.169.254/latest.css"><img src="/ok.png">',
      },
    });
    const result = await scanPage('https://site.example/page', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      dohCheck: false,
    });
    expect(result.images.map((i) => i.url)).toEqual(['https://site.example/ok.png']);
    // robots + page only — the metadata URL was never fetched
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('truncates a page bigger than the HTML cap and reports size-cap', async () => {
    // 6 MB page: 5 MB of filler, then an image tag past the cap.
    const filler = `<p>${'x'.repeat(6_000_000)}</p>`;
    const result = await scanPage(
      'https://site.example/huge',
      deps({
        'https://site.example/robots.txt': { status: 404 },
        'https://site.example/huge': { body: `<img src="/first.png">${filler}<img src="/late.png">` },
      }),
    );
    expect(result.images.map((i) => i.url)).toEqual(['https://site.example/first.png']);
    expect(result.truncated).toBe('size-cap');
  });

  it('reports size-cap when both the size and image caps fire', async () => {
    const tags = Array.from({ length: 1200 }, (_, i) => `<img src="/img/${i}.png">`).join('');
    const filler = `<p>${'x'.repeat(6_000_000)}</p>`;
    const result = await scanPage(
      'https://site.example/huge-gallery',
      deps({
        'https://site.example/robots.txt': { status: 404 },
        'https://site.example/huge-gallery': { body: `${tags}${filler}` },
      }),
    );
    expect(result.images).toHaveLength(1000);
    expect(result.truncated).toBe('size-cap');
  });

  it('rejects a blocked initial URL before any fetch', async () => {
    const fetchImpl = routedFetch({});
    await expect(
      scanPage('http://localhost/x', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        dohCheck: false,
      }),
    ).rejects.toMatchObject({ name: 'BlockedHostError', reason: 'blocked-hostname' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('GET /api/scan', () => {
  const call = (query: string): Promise<Response> =>
    Promise.resolve(
      GET({
        url: new URL(`https://ours.example/api/scan${query}`),
      } as Parameters<typeof GET>[0]),
    );

  it('400s without a url parameter', async () => {
    const response = await call('');
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid-request');
  });

  it('maps guard rejections to typed JSON errors', async () => {
    const response = await call('?url=http%3A%2F%2Flocalhost%2Fsecrets');
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('blocked-hostname');
    expect(body.message).toContain('public internet');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('maps bad schemes to 400', async () => {
    const response = await call('?url=ftp%3A%2F%2Fsite.example%2F');
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('bad-scheme');
  });
});
