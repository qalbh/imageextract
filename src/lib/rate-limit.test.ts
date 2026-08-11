import { beforeEach, describe, expect, it } from 'vitest';
import {
  RATE_LIMITS,
  RATE_WINDOW_MS,
  checkRateLimit,
  clearRateCounters,
} from './rate-limit';
import { GET as scanGet } from '../pages/api/scan';

beforeEach(() => clearRateCounters());

const T0 = 1_700_000_000_000;

describe('checkRateLimit', () => {
  it('admits up to the limit and rejects the next request', () => {
    for (let i = 0; i < RATE_LIMITS.scan; i++) {
      expect(checkRateLimit('scan', '1.2.3.4', T0 + i).ok).toBe(true);
    }
    const verdict = checkRateLimit('scan', '1.2.3.4', T0 + 1000);
    expect(verdict.ok).toBe(false);
  });

  it('reports seconds until the window resets, from the WINDOW start not the rejection time', () => {
    for (let i = 0; i < RATE_LIMITS.scan; i++) checkRateLimit('scan', '1.2.3.4', T0);
    const halfway = T0 + RATE_WINDOW_MS / 2;
    const verdict = checkRateLimit('scan', '1.2.3.4', halfway);
    expect(verdict).toEqual({ ok: false, retryAfterSeconds: RATE_WINDOW_MS / 2 / 1000 });
  });

  it('resets after the window expires', () => {
    for (let i = 0; i < RATE_LIMITS.scan; i++) checkRateLimit('scan', '1.2.3.4', T0);
    expect(checkRateLimit('scan', '1.2.3.4', T0 + 1).ok).toBe(false);
    expect(checkRateLimit('scan', '1.2.3.4', T0 + RATE_WINDOW_MS).ok).toBe(true);
  });

  it('keys are independent across kinds and across IPs', () => {
    for (let i = 0; i < RATE_LIMITS.scan; i++) checkRateLimit('scan', '1.2.3.4', T0);
    expect(checkRateLimit('scan', '1.2.3.4', T0).ok).toBe(false);
    // Same IP, different budget: untouched.
    expect(checkRateLimit('proxy', '1.2.3.4', T0).ok).toBe(true);
    // Different IP, same budget: untouched.
    expect(checkRateLimit('scan', '5.6.7.8', T0).ok).toBe(true);
  });

  it('absent header fails open: no counting, always admitted', () => {
    for (let i = 0; i < RATE_LIMITS.scan * 2; i++) {
      expect(checkRateLimit('scan', null, T0 + i).ok).toBe(true);
    }
  });

  it('a rejected request does not extend or restart the window', () => {
    for (let i = 0; i < RATE_LIMITS.scan; i++) checkRateLimit('scan', '1.2.3.4', T0);
    // Hammering while limited must not push the reset time out.
    for (let i = 0; i < 50; i++) checkRateLimit('scan', '1.2.3.4', T0 + RATE_WINDOW_MS - 1);
    expect(checkRateLimit('scan', '1.2.3.4', T0 + RATE_WINDOW_MS).ok).toBe(true);
  });
});

describe('scan route rate limiting', () => {
  // Guard-rejected URL: real inbound requests that spend budget but cost
  // zero subrequests, so the loop below never touches the network.
  const scanContext = (ip: string | null) =>
    ({
      url: new URL('https://self.example/api/scan?url=http%3A%2F%2F10.0.0.5%2F'),
      request: new Request('https://self.example/api/scan', {
        headers: ip === null ? {} : { 'cf-connecting-ip': ip },
      }),
    }) as unknown as Parameters<typeof scanGet>[0];

  it('serves the 31st scan a 429 with the shared-egress copy and Retry-After', async () => {
    for (let i = 0; i < RATE_LIMITS.scan; i++) {
      const res = await scanGet(scanContext('9.9.9.9'));
      expect(res.status).toBe(403); // private-ip — budget spent, no network
    }
    const limited = await scanGet(scanContext('9.9.9.9'));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
    const body = (await limited.json()) as { error: string; message: string };
    expect(body.error).toBe('rate-limited');
    // The copy's load-bearing clauses: what, shared, when. Never "you".
    expect(body.message).toContain('30 page scans per hour');
    expect(body.message).toContain('shared');
    expect(body.message).toMatch(/try again in about \d+ minutes?/);
    expect(body.message).not.toMatch(/\byou\b/i);
  });

  it('absent CF-Connecting-IP admits unlimited and stamps the unenforced canary', async () => {
    for (let i = 0; i < RATE_LIMITS.scan + 5; i++) {
      const res = await scanGet(scanContext(null));
      expect(res.status).toBe(403);
      // The canary rides every response so an operator's curl sees it.
      expect(res.headers.get('x-rate-limit')).toBe('unenforced');
    }
  });

  it('never stamps the canary when the edge identified the caller', async () => {
    const res = await scanGet(scanContext('7.7.7.7'));
    expect(res.headers.get('x-rate-limit')).toBeNull();
  });
});
