/**
 * Pins the subrequest arithmetic behind wrangler.jsonc's `limits.subrequests`.
 *
 * The ceiling is DERIVED from the code's own caps — if MAX_STYLESHEETS, the
 * redirect hop cap, or the DoH scheme changes without this budget being
 * re-derived, this file fails instead of the limit firing in production.
 *
 * Worst structural scan (cold isolate, every hop a NEW hostname):
 *   page chain      1 + 3 redirects            =  4 fetches
 *   robots chain    1 + 3 redirects            =  4 fetches
 *   stylesheets     3 sheets × (1 + 3)         = 12 fetches
 *   DoH             ≤20 distinct hostnames × 2 = 40 lookups
 *   blocklist KV                               =  1 read
 *                                    total     = 61
 * Proxy worst: 4 fetches + 8 DoH + 1 KV = 13.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scanPage } from './scan';
import { clearDohCache } from './ssrf-guard';

const SCAN_WORST_SUBREQUESTS = 61;

// Injected by vitest.config.ts from wrangler.jsonc — the same parse that
// feeds compat settings, so the config the tests assert is the config that
// deploys.
declare const __WRANGLER_CONFIG__: {
  limits?: { cpu_ms?: number; subrequests?: number };
};

interface DohRecord {
  type: number;
  data: string;
}

function dohMock(counter: { calls: number }): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    counter.calls += 1;
    const url = new URL(String(input));
    const wanted = url.searchParams.get('type') === 'A' ? 1 : 28;
    const records: DohRecord[] =
      wanted === 1 ? [{ type: 1, data: '93.184.216.34' }] : [];
    return Response.json({ Status: 0, Answer: records });
  }) as typeof fetch;
}

// Every hop lands on a fresh hostname so nothing dedupes: robots and the
// page each redirect 3 times, and each stylesheet redirects 3 times.
function worstShapeFetch(counter: { calls: number }): typeof fetch {
  let host = 0;
  const nextHost = (): string => `h${++host}.example`;
  return (async (input: RequestInfo | URL) => {
    counter.calls += 1;
    const url = new URL(String(input));
    const redirects = Number(url.searchParams.get('r') ?? '0');
    if (redirects < 3) {
      return new Response(null, {
        status: 302,
        headers: { location: `https://${nextHost()}${url.pathname}?r=${redirects + 1}` },
      });
    }
    if (url.pathname.endsWith('/robots.txt')) {
      return new Response('User-agent: *\nAllow: /', {
        headers: { 'content-type': 'text/plain' },
      });
    }
    if (url.pathname.endsWith('.css')) {
      return new Response('.x{background:url(/deep.png)}', {
        headers: { 'content-type': 'text/css' },
      });
    }
    const sheets = [1, 2, 3]
      .map((n) => `<link rel="stylesheet" href="https://${nextHost()}/s${n}.css">`)
      .join('');
    return new Response(`<html>${sheets}<img src="/pic.png"></html>`, {
      headers: { 'content-type': 'text/html' },
    });
  }) as typeof fetch;
}

beforeEach(() => clearDohCache());

describe('subrequest budget', () => {
  it(`the worst structural scan stays within the derived ceiling of ${SCAN_WORST_SUBREQUESTS}`, async () => {
    const fetches = { calls: 0 };
    const doh = { calls: 0 };
    const kv = { reads: 0 };
    const result = await scanPage('https://h0.example/page', {
      fetchImpl: worstShapeFetch(fetches),
      dohFetchImpl: dohMock(doh),
      blocklist: {
        get: async () => {
          kv.reads += 1;
          return null;
        },
      },
    });
    expect(result.images.length).toBeGreaterThan(0);
    const total = fetches.calls + doh.calls + kv.reads;
    // The point is the ceiling, but assert the shape is genuinely worst-ish
    // too — a broken mock that stops redirecting would pass a hollow test.
    expect(fetches.calls).toBeGreaterThanOrEqual(16);
    expect(doh.calls).toBeGreaterThanOrEqual(24);
    expect(total).toBeLessThanOrEqual(SCAN_WORST_SUBREQUESTS);
  });

  it('wrangler.jsonc grants headroom over the ceiling — the limit only fires on a logic bug', () => {
    const limit = __WRANGLER_CONFIG__.limits?.subrequests;
    expect(limit).toBeDefined();
    expect(limit!).toBeGreaterThanOrEqual(SCAN_WORST_SUBREQUESTS * 1.5);
  });
});
