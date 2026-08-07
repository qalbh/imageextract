import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BlockedHostError,
  TimeoutError,
  TooManyRedirectsError,
  clearDohCache,
  dohCheckHostname,
  safeFetch,
  validateTargetUrl,
} from './ssrf-guard';

// The DoH verdict cache is module-level state; every test starts cold.
beforeEach(() => clearDohCache());

function expectRejected(raw: string, reason: string) {
  const verdict = validateTargetUrl(raw);
  expect(verdict.ok, `${raw} should be rejected`).toBe(false);
  if (!verdict.ok) expect(verdict.reason, `${raw} rejection reason`).toBe(reason);
}

function expectAllowed(raw: string) {
  const verdict = validateTargetUrl(raw);
  expect(verdict.ok, `${raw} should be allowed`).toBe(true);
}

describe('validateTargetUrl: scheme (rule 1)', () => {
  it.each(['ftp://example.com/', 'file:///etc/passwd', 'ws://example.com/', 'wss://example.com/', 'data:text/html,hi', 'javascript:alert(1)'])(
    'rejects %s',
    (raw) => expectRejected(raw, 'bad-scheme'),
  );

  it('rejects unparseable input', () => {
    expectRejected('not a url', 'invalid-url');
    expectRejected('', 'invalid-url');
    expectRejected('http://999.999.999.999/', 'invalid-url');
  });
});

describe('validateTargetUrl: ports (rule 2)', () => {
  it.each(['http://example.com:8080/', 'https://example.com:8443/', 'http://example.com:22/', 'https://example.com:6379/'])(
    'rejects %s',
    (raw) => expectRejected(raw, 'bad-port'),
  );

  it.each(['http://example.com/', 'http://example.com:80/', 'https://example.com/', 'https://example.com:443/', 'http://example.com:443/', 'https://example.com:80/'])(
    'allows %s',
    (raw) => expectAllowed(raw),
  );
});

describe('validateTargetUrl: reserved IPv4 ranges (rule 3)', () => {
  // Both edges of every range, plus a neighbor outside each edge.
  const blocked = [
    // 127.0.0.0/8
    'http://127.0.0.1/', 'http://127.255.255.255/',
    // 10.0.0.0/8
    'http://10.0.0.0/', 'http://10.255.255.255/',
    // 172.16.0.0/12
    'http://172.16.0.0/', 'http://172.31.255.255/',
    // 192.168.0.0/16
    'http://192.168.0.0/', 'http://192.168.255.255/',
    // 169.254.0.0/16 — includes the metadata IP
    'http://169.254.0.0/', 'http://169.254.169.254/', 'http://169.254.255.255/',
    // 100.64.0.0/10 — includes Alibaba metadata
    'http://100.64.0.0/', 'http://100.100.100.200/', 'http://100.127.255.255/',
    // 0.0.0.0/8
    'http://0.0.0.0/', 'http://0.255.255.255/',
  ];
  it.each(blocked)('rejects %s', (raw) => expectRejected(raw, 'private-ip'));

  const allowed = [
    'http://126.255.255.255/', 'http://128.0.0.0/',
    'http://9.255.255.255/', 'http://11.0.0.0/',
    'http://172.15.255.255/', 'http://172.32.0.0/',
    'http://192.167.255.255/', 'http://192.169.0.0/',
    'http://169.253.255.255/', 'http://169.255.0.0/',
    'http://100.63.255.255/', 'http://100.128.0.0/',
    'http://1.0.0.0/', 'http://93.184.216.34/',
  ];
  it.each(allowed)('allows %s', (raw) => expectAllowed(raw));
});

describe('validateTargetUrl: exotic IPv4 encodings (rule 3)', () => {
  const blocked = [
    'http://2130706433/',      // decimal 127.0.0.1
    'http://0x7f000001/',      // hex 127.0.0.1
    'http://017700000001/',    // octal 127.0.0.1
    'http://0x7f.0.0.1/',      // mixed hex
    'http://127.1/',           // short form
    'http://0300.0250.0.1/',   // octal 192.168.0.1
    'http://0xa9.0xfe.0xa9.0xfe/', // hex 169.254.169.254
    'http://0/',               // 0.0.0.0
    'http://127.0.0.1./',      // trailing dot
  ];
  it.each(blocked)('rejects %s', (raw) => expectRejected(raw, 'private-ip'));

  it('allows a public address in decimal form', () => {
    // 1572395042 === 93.184.216.34
    expectAllowed('http://1572395042/');
  });
});

describe('validateTargetUrl: reserved IPv6 ranges (rule 3)', () => {
  const blocked = [
    'http://[::1]/',
    'http://[::]/',
    'http://[fc00::1]/', 'http://[fdff::1]/',            // fc00::/7 edges
    'http://[fe80::1]/', 'http://[febf::1]/',            // fe80::/10 edges
    'http://[::ffff:10.0.0.1]/',                          // IPv4-mapped private
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[::ffff:192.168.1.1]/',
  ];
  it.each(blocked)('rejects %s', (raw) => expectRejected(raw, 'private-ip'));

  const allowed = [
    'http://[2606:4700::1111]/',
    'http://[fe00::1]/',  // below fc00::/7's neighbors but outside both ranges
    'http://[fec0::1]/',  // just above fe80::/10
    // Mapped-to-public connects to the public IPv4; the doc only blocks
    // mapped forms whose embedded address is reserved.
    'http://[::ffff:8.8.8.8]/',
  ];
  it.each(allowed)('allows %s', (raw) => expectAllowed(raw));
});

describe('validateTargetUrl: internal-by-convention hostnames (rule 4)', () => {
  const blocked = [
    'http://localhost/',
    'https://localhost/',
    'http://localhost./',
    'http://foo.local/',
    'http://printer.local/',
    'http://foo.internal/',
    'http://metadata.google.internal/',
    'http://foo.localdomain/',
    'http://sub.app.localhost/',
    'http://metadata.goog/',
    'http://instance-data/',
  ];
  it.each(blocked)('rejects %s', (raw) => expectRejected(raw, 'blocked-hostname'));

  const allowed = [
    'http://localhost.example.com/',   // suffix must match, not substring
    'http://internal.example.com/',
    'http://mylocal.example.com/',
    'http://example.com./',            // public name with trailing dot
  ];
  it.each(allowed)('allows %s', (raw) => expectAllowed(raw));
});

// --- DoH pre-check ---

type DohRecord = { type: number; data: string };

function dohMock(recordsByName: Record<string, DohRecord[]>, status = 0): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const name = url.searchParams.get('name') ?? '';
    const wanted = url.searchParams.get('type') === 'A' ? 1 : 28;
    const records = (recordsByName[name] ?? []).filter((r) => r.type === wanted || r.type === 5);
    return Response.json({ Status: status, Answer: records });
  }) as typeof fetch;
}

describe('dohCheckHostname', () => {
  it('allows a hostname resolving to public addresses', async () => {
    const fetchImpl = dohMock({ 'example.com': [{ type: 1, data: '93.184.216.34' }] });
    expect(await dohCheckHostname('example.com', { fetchImpl })).toEqual({ ok: true });
  });

  it('rejects a private A record', async () => {
    const fetchImpl = dohMock({ 'evil.example': [{ type: 1, data: '10.0.0.5' }] });
    const verdict = await dohCheckHostname('evil.example', { fetchImpl });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('dns-private');
  });

  it('rejects when any record among several is private', async () => {
    const fetchImpl = dohMock({
      'evil.example': [
        { type: 1, data: '93.184.216.34' },
        { type: 1, data: '169.254.169.254' },
      ],
    });
    const verdict = await dohCheckHostname('evil.example', { fetchImpl });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('dns-private');
  });

  it('rejects a private AAAA record', async () => {
    const fetchImpl = dohMock({ 'evil.example': [{ type: 28, data: 'fc00::1' }] });
    const verdict = await dohCheckHostname('evil.example', { fetchImpl });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('dns-private');
  });

  it('rejects a mapped-private AAAA record', async () => {
    const fetchImpl = dohMock({ 'evil.example': [{ type: 28, data: '::ffff:192.168.0.10' }] });
    const verdict = await dohCheckHostname('evil.example', { fetchImpl });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('dns-private');
  });

  it('follows CNAME answers to the terminal A record', async () => {
    const fetchImpl = dohMock({
      'alias.example': [
        { type: 5, data: 'target.example.' },
        { type: 1, data: '93.184.216.34' },
      ],
    });
    expect(await dohCheckHostname('alias.example', { fetchImpl })).toEqual({ ok: true });
  });

  it('reports dns-nxdomain when DNS answers cleanly with no records (NOERROR)', async () => {
    const fetchImpl = dohMock({});
    const verdict = await dohCheckHostname('nxdomain.example', { fetchImpl });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('dns-nxdomain');
  });

  it('reports dns-nxdomain on an NXDOMAIN status', async () => {
    const fetchImpl = dohMock({}, 3);
    const verdict = await dohCheckHostname('typo.exampel', { fetchImpl });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('dns-nxdomain');
  });

  it('keeps SERVFAIL as dns-error, not nxdomain', async () => {
    const fetchImpl = dohMock({}, 2);
    const verdict = await dohCheckHostname('broken.example', { fetchImpl });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('dns-error');
  });

  it('fails closed when the DoH request itself fails', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const verdict = await dohCheckHostname('example.com', { fetchImpl });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('dns-error');
  });

  it('fails closed on a non-2xx DoH response', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const verdict = await dohCheckHostname('example.com', { fetchImpl });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('dns-error');
  });
});

describe('DoH verdict cache', () => {
  it('serves a repeat hostname from cache without new queries', async () => {
    const fetchImpl = vi.fn(dohMock({ 'example.com': [{ type: 1, data: '93.184.216.34' }] }));
    await dohCheckHostname('example.com', { fetchImpl: fetchImpl as unknown as typeof fetch });
    await dohCheckHostname('example.com', { fetchImpl: fetchImpl as unknown as typeof fetch });
    // One A + one AAAA query total; the second check hit the cache.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('caches negative dns-private verdicts too', async () => {
    const fetchImpl = vi.fn(dohMock({ 'evil.example': [{ type: 1, data: '10.0.0.5' }] }));
    const first = await dohCheckHostname('evil.example', { fetchImpl: fetchImpl as unknown as typeof fetch });
    const second = await dohCheckHostname('evil.example', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(first.ok).toBe(false);
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not cache transient dns-error verdicts', async () => {
    let failing = true;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (failing) throw new Error('network blip');
      return dohMock({ 'flaky.example': [{ type: 1, data: '93.184.216.34' }] })(input);
    });
    const first = await dohCheckHostname('flaky.example', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.reason).toBe('dns-error');
    failing = false;
    const second = await dohCheckHostname('flaky.example', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(second).toEqual({ ok: true });
  });

  it('expires entries after the TTL', async () => {
    const fetchImpl = vi.fn(dohMock({ 'example.com': [{ type: 1, data: '93.184.216.34' }] }));
    const t0 = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      await dohCheckHostname('example.com', { fetchImpl: fetchImpl as unknown as typeof fetch });
      nowSpy.mockReturnValue(t0 + 59_000);
      await dohCheckHostname('example.com', { fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(fetchImpl).toHaveBeenCalledTimes(2); // still cached
      nowSpy.mockReturnValue(t0 + 61_000);
      await dohCheckHostname('example.com', { fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(fetchImpl).toHaveBeenCalledTimes(4); // expired, re-queried
    } finally {
      nowSpy.mockRestore();
    }
  });
});

// --- safeFetch ---

type Route = { status?: number; location?: string; body?: string };

function chainFetch(routes: Record<string, Route>) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const key = String(input);
    const route = routes[key];
    if (!route) throw new Error('fetch reached a URL the test did not map');
    if (route.location !== undefined) {
      return new Response(null, {
        status: route.status ?? 302,
        headers: { location: route.location },
      });
    }
    return new Response(route.body ?? 'ok', { status: route.status ?? 200 });
  });
}

describe('safeFetch', () => {
  it('follows a public redirect chain and returns the final response', async () => {
    const fetchImpl = chainFetch({
      'https://a.example/': { location: 'https://b.example/x' },
      'https://b.example/x': { location: 'https://c.example/y' },
      'https://c.example/y': { location: 'https://d.example/z' },
      'https://d.example/z': { body: 'made it' },
    });
    const response = await safeFetch('https://a.example/', {
      timeoutMs: 5_000,
      dohCheck: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await response.text()).toBe('made it');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    for (const call of fetchImpl.mock.calls) {
      expect((call[1] as RequestInit).redirect).toBe('manual');
    }
  });

  it('rejects a redirect chain whose final hop is a private IP, without fetching it', async () => {
    const fetchImpl = chainFetch({
      'https://a.example/': { location: 'https://b.example/x' },
      'https://b.example/x': { location: 'http://10.0.0.5/admin' },
    });
    await expect(
      safeFetch('https://a.example/', {
        timeoutMs: 5_000,
        dohCheck: false,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ name: 'BlockedHostError', reason: 'private-ip' });
    // The guard must reject before the private URL is ever fetched.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects a redirect to a decimal-encoded private IP', async () => {
    const fetchImpl = chainFetch({
      'https://a.example/': { location: 'http://2130706433/' },
    });
    await expect(
      safeFetch('https://a.example/', {
        timeoutMs: 5_000,
        dohCheck: false,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ name: 'BlockedHostError', reason: 'private-ip' });
  });

  it('rejects a redirect to localhost', async () => {
    const fetchImpl = chainFetch({
      'https://a.example/': { status: 307, location: 'http://localhost/secrets' },
    });
    await expect(
      safeFetch('https://a.example/', {
        timeoutMs: 5_000,
        dohCheck: false,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ name: 'BlockedHostError', reason: 'blocked-hostname' });
  });

  it('resolves relative Location headers against the current URL', async () => {
    const fetchImpl = chainFetch({
      'https://a.example/start': { location: '/next' },
      'https://a.example/next': { body: 'relative ok' },
    });
    const response = await safeFetch('https://a.example/start', {
      timeoutMs: 5_000,
      dohCheck: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await response.text()).toBe('relative ok');
  });

  it('throws after more than 3 redirects', async () => {
    const fetchImpl = chainFetch({
      'https://a.example/': { location: 'https://b.example/' },
      'https://b.example/': { location: 'https://c.example/' },
      'https://c.example/': { location: 'https://d.example/' },
      'https://d.example/': { location: 'https://e.example/' },
      'https://e.example/': { body: 'never reached' },
    });
    await expect(
      safeFetch('https://a.example/', {
        timeoutMs: 5_000,
        dohCheck: false,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(TooManyRedirectsError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('returns a 3xx that has no Location header instead of looping', async () => {
    const fetchImpl = chainFetch({ 'https://a.example/': { status: 302 } });
    const response = await safeFetch('https://a.example/', {
      timeoutMs: 5_000,
      dohCheck: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(response.status).toBe(302);
  });

  it('rejects the initial URL before any network activity', async () => {
    const fetchImpl = chainFetch({});
    await expect(
      safeFetch('http://192.168.1.1/', {
        timeoutMs: 5_000,
        dohCheck: false,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(BlockedHostError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('consults DoH per hostname and rejects a hop that resolves privately', async () => {
    const fetchImpl = chainFetch({
      'https://a.example/': { location: 'https://rebind.example/' },
    });
    const dohFetchImpl = dohMock({
      'a.example': [{ type: 1, data: '93.184.216.34' }],
      'rebind.example': [{ type: 1, data: '169.254.169.254' }],
    });
    await expect(
      safeFetch('https://a.example/', {
        timeoutMs: 5_000,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        dohFetchImpl,
      }),
    ).rejects.toMatchObject({ name: 'BlockedHostError', reason: 'dns-private' });
    // Only the first hop was actually fetched.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('skips DoH for IP-literal hostnames', async () => {
    const fetchImpl = chainFetch({ 'http://93.184.216.34/': { body: 'direct' } });
    const dohFetchImpl = vi.fn(async () => {
      throw new Error('DoH must not be called for IP literals');
    });
    const response = await safeFetch('http://93.184.216.34/', {
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      dohFetchImpl: dohFetchImpl as unknown as typeof fetch,
    });
    expect(await response.text()).toBe('direct');
    expect(dohFetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when DoH is unreachable', async () => {
    const fetchImpl = chainFetch({ 'https://a.example/': { body: 'never reached' } });
    const dohFetchImpl = (async () => {
      throw new Error('DoH down');
    }) as unknown as typeof fetch;
    await expect(
      safeFetch('https://a.example/', {
        timeoutMs: 5_000,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        dohFetchImpl,
      }),
    ).rejects.toMatchObject({ name: 'BlockedHostError', reason: 'dns-error' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws TimeoutError when the fetch outlives timeoutMs', async () => {
    const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;
    await expect(
      safeFetch('https://slow.example/', {
        timeoutMs: 30,
        dohCheck: false,
        fetchImpl: hanging,
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
