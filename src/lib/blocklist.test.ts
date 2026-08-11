import { beforeEach, describe, expect, it, vi } from 'vitest';
// The REAL test KV binding (miniflare, declared in vitest.config.ts) — the
// route tests below write it and then exercise the production read path
// through `cloudflare:workers` env. A stubbed-locals variant of these tests
// once passed against an adapter API that no longer existed; only the
// dev-boot check caught it. Real binding, no repeat.
import { env } from 'cloudflare:test';
import {
  BLOCKLIST_KEY,
  BLOCKLIST_TTL_MS,
  blocklistBinding,
  clearBlocklistCache,
  isBlockedHostname,
  loadBlocklist,
  parseBlocklist,
  type BlocklistKv,
} from './blocklist';
import { safeFetch } from './ssrf-guard';
import { GET as scanGet } from '../pages/api/scan';
import { GET as proxyGet } from '../pages/api/proxy';

const testKv = (env as { BLOCKLIST: BlocklistKv & { put(k: string, v: string): Promise<void> } })
  .BLOCKLIST;

beforeEach(() => clearBlocklistCache());

const kvOf = (text: string | null): BlocklistKv => ({ get: async () => text });

describe('parseBlocklist', () => {
  it('skips blanks and comments, lowercases, strips trailing FQDN dots', () => {
    expect(parseBlocklist('# abuse 2026-08\n\nExample.COM\nother.example.\n')).toEqual([
      'example.com',
      'other.example',
    ]);
  });

  it('forgives full-URL pastes: scheme, path, and query are stripped', () => {
    // An operator pasting a URL mid-abuse-response must not add a no-op line.
    expect(parseBlocklist('https://example.com/products?page=2')).toEqual(['example.com']);
  });

  it('punycodes IDN entries so they match parsed hostnames', () => {
    expect(parseBlocklist('münchen.example')).toEqual(['xn--mnchen-3ya.example']);
  });

  it('skips truly unparseable lines without failing the rest', () => {
    expect(parseBlocklist('ex ample.com\ngood.example')).toEqual(['good.example']);
  });
});

describe('isBlockedHostname', () => {
  const entries = ['example.com'];
  it('matches the host itself and every subdomain', () => {
    expect(isBlockedHostname('example.com', entries)).toBe(true);
    expect(isBlockedHostname('www.example.com', entries)).toBe(true);
    expect(isBlockedHostname('cdn.img.example.com', entries)).toBe(true);
    expect(isBlockedHostname('EXAMPLE.com', entries)).toBe(true);
  });
  it('the dot boundary keeps lookalike hosts unmatched', () => {
    expect(isBlockedHostname('notexample.com', entries)).toBe(false);
    expect(isBlockedHostname('example.com.evil.net', entries)).toBe(false);
  });
});

describe('loadBlocklist cache', () => {
  it('reads KV once per TTL, then again after expiry', async () => {
    const get = vi.fn(async (key: string) => (key === BLOCKLIST_KEY ? 'example.com' : null));
    const kv: BlocklistKv = { get };
    expect(await loadBlocklist(kv, 1000)).toEqual(['example.com']);
    expect(await loadBlocklist(kv, 2000)).toEqual(['example.com']);
    expect(get).toHaveBeenCalledTimes(1);
    await loadBlocklist(kv, 1000 + BLOCKLIST_TTL_MS);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('a read failure fails open AND is cached, so an erroring KV is not hammered', async () => {
    const get = vi.fn(async () => {
      throw new Error('kv unavailable');
    });
    const kv: BlocklistKv = { get };
    expect(await loadBlocklist(kv, 1000)).toEqual([]);
    expect(await loadBlocklist(kv, 2000)).toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('a missing key is an empty list', async () => {
    expect(await loadBlocklist(kvOf(null), 1000)).toEqual([]);
  });
});

describe('safeFetch blocklist integration', () => {
  it('rejects a blocked initial URL before ANY fetch — the block costs zero subrequests', async () => {
    const fetchImpl = vi.fn();
    await expect(
      safeFetch('https://cdn.blocked.example/img.png', {
        timeoutMs: 5000,
        dohCheck: false,
        blocklist: kvOf('blocked.example'),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ name: 'BlockedHostError', reason: 'domain-blocked' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('catches a redirect INTO a blocked host at the hop', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://blocked.example/x' } }),
    );
    await expect(
      safeFetch('https://allowed.example/', {
        timeoutMs: 5000,
        dohCheck: false,
        blocklist: kvOf('blocked.example'),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ name: 'BlockedHostError', reason: 'domain-blocked' });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // hop 1 fetched, hop 2 blocked
  });
});

describe('routes: domain-blocked is a typed 403 on both endpoints (real KV binding)', () => {
  const ctx = (path: string) =>
    ({
      url: new URL(`https://self.example${path}`),
      request: new Request(`https://self.example${path}`),
    }) as unknown as Parameters<typeof scanGet>[0];

  beforeEach(async () => {
    await testKv.put(BLOCKLIST_KEY, '# abuse\nblocked.example\n');
    clearBlocklistCache();
  });

  it('scan: blocked page host → 403 domain-blocked with the honest copy, zero network', async () => {
    const res = await scanGet(ctx('/api/scan?url=https%3A%2F%2Fblocked.example%2Fgallery'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('domain-blocked');
    expect(body.message).toContain("at its owner's request, or for abuse prevention");
  });

  it('proxy: blocked image host → same typed 403 (image URLs die too, even post-scan)', async () => {
    const res = await proxyGet(ctx('/api/proxy?url=https%3A%2F%2Fimg.blocked.example%2Fa.png'));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('domain-blocked');
  });

  it('blocklistBinding resolves the test binding (the production read path, not a stub)', () => {
    expect(blocklistBinding()).not.toBeNull();
  });
});
