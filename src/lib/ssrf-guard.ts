/**
 * SSRF guard for /api/scan and /api/proxy.
 *
 * Workers expose no DNS API and no way to pin a connection to a validated
 * IP, so the guard is built from what is available: syntactic checks on
 * every URL (initial and each redirect hop), a DNS-over-HTTPS pre-check,
 * manual redirect following, and hard timeouts. DNS rebinding remains
 * structurally open on this platform; the DoH check narrows it only.
 *
 * Nothing in this module logs, and no Error message may contain the target
 * URL or hostname — thrown errors can reach observability, and no URL may
 * appear in any log line. Rejection details name the rule that fired,
 * never the submitted value.
 */

export type RejectionReason =
  | 'invalid-url'
  | 'bad-scheme'
  | 'bad-port'
  | 'private-ip'
  | 'blocked-hostname'
  | 'dns-private'
  | 'dns-nxdomain'
  | 'dns-error';

export type GuardVerdict =
  | { ok: true; url: URL }
  | { ok: false; reason: RejectionReason; detail: string };

export class BlockedHostError extends Error {
  constructor(
    readonly reason: RejectionReason,
    readonly detail: string,
  ) {
    super(`Target blocked by SSRF guard: ${detail}`);
    this.name = 'BlockedHostError';
  }
}

export class TooManyRedirectsError extends Error {
  constructor(readonly maxRedirects: number) {
    super(`Exceeded ${maxRedirects} redirects`);
    this.name = 'TooManyRedirectsError';
  }
}

export class TimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

const RESERVED_V4: ReadonlyArray<readonly [cidr: string, base: number, bits: number]> = [
  ['127.0.0.0/8', 0x7f000000, 8],
  ['10.0.0.0/8', 0x0a000000, 8],
  ['172.16.0.0/12', 0xac100000, 12],
  ['192.168.0.0/16', 0xc0a80000, 16],
  ['169.254.0.0/16', 0xa9fe0000, 16],
  ['100.64.0.0/10', 0x64400000, 10],
  ['0.0.0.0/8', 0x00000000, 8],
  ['192.0.2.0/24', 0xc0000200, 24], // TEST-NET-1
  ['198.51.100.0/24', 0xc6336400, 24], // TEST-NET-2
  ['203.0.113.0/24', 0xcb007100, 24], // TEST-NET-3
  ['198.18.0.0/15', 0xc6120000, 15], // benchmarking
  ['224.0.0.0/4', 0xe0000000, 4], // multicast
  ['240.0.0.0/4', 0xf0000000, 4], // reserved; subsumes 255.255.255.255
];

function reservedV4Range(ip: number): string | null {
  for (const [cidr, base, bits] of RESERVED_V4) {
    const mask = (~0 << (32 - bits)) >>> 0;
    if (((ip & mask) >>> 0) === base) return cidr;
  }
  return null;
}

// Strict dotted-quad only — used for DoH answer data and IPv4 embedded in
// IPv6, which are always canonical. URL hostnames go through
// parseIpv4Literal instead, which accepts the exotic forms.
function parseDottedQuad(s: string): number | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let ip = 0;
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) return null;
    const value = parseInt(part, 10);
    if (value > 255) return null;
    ip = ip * 256 + value;
  }
  return ip;
}

// The WHATWG URL parser canonicalizes numeric hosts ("2130706433",
// "0x7f000001", "0177.0.0.1") to dotted decimal before we ever see them,
// but we re-parse every form ourselves rather than trusting that: the guard
// must hold even if a differently-normalizing URL implementation ran first.
function parseIpv4Literal(host: string): number | null {
  const trimmed = host.endsWith('.') ? host.slice(0, -1) : host;
  if (trimmed === '') return null;
  const parts = trimmed.split('.');
  if (parts.length > 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    let value: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) value = parseInt(part.slice(2), 16);
    else if (/^0[xX]$/.test(part)) value = 0;
    else if (/^0[0-7]*$/.test(part)) value = parseInt(part, 8) || 0;
    else if (/^[1-9][0-9]*$/.test(part)) value = parseInt(part, 10);
    else return null;
    nums.push(value);
  }
  // WHATWG rule: the last part fills every remaining byte, so "127.1" is
  // 127.0.0.1 and a bare "2130706433" is the whole address.
  const last = nums[nums.length - 1] as number;
  const prefix = nums.slice(0, -1);
  const remainingBytes = 4 - prefix.length;
  if (last >= 2 ** (8 * remainingBytes)) return null;
  if (prefix.some((n) => n > 255)) return null;
  let ip = 0;
  for (const n of prefix) ip = ip * 256 + n;
  return ip * 2 ** (8 * remainingBytes) + last;
}

// Returns the address as 8 16-bit groups, or null if unparseable.
function parseIpv6(literal: string): number[] | null {
  if (literal.includes('%')) return null;
  let head = literal;
  let tail = '';
  const compressed = literal.indexOf('::');
  if (compressed !== -1) {
    if (literal.indexOf('::', compressed + 1) !== -1) return null;
    head = literal.slice(0, compressed);
    tail = literal.slice(compressed + 2);
  }
  const parseGroups = (s: string): number[] | null => {
    if (s === '') return [];
    const tokens = s.split(':');
    const out: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i] as string;
      if (/^[0-9a-fA-F]{1,4}$/.test(token)) {
        out.push(parseInt(token, 16));
      } else if (token.includes('.') && i === tokens.length - 1) {
        // Embedded IPv4 tail, e.g. ::ffff:10.0.0.1
        const v4 = parseDottedQuad(token);
        if (v4 === null) return null;
        out.push(Math.floor(v4 / 0x10000), v4 & 0xffff);
      } else {
        return null;
      }
    }
    return out;
  };
  const headGroups = parseGroups(head);
  const tailGroups = parseGroups(tail);
  if (headGroups === null || tailGroups === null) return null;
  if (compressed === -1) {
    return headGroups.length === 8 ? headGroups : null;
  }
  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 1) return null;
  return [...headGroups, ...(Array(missing).fill(0) as number[]), ...tailGroups];
}

function reservedV6Range(groups: number[]): string | null {
  const zeroThrough = (end: number) => groups.slice(0, end).every((g) => g === 0);
  if (zeroThrough(7) && groups[7] === 1) return '::1';
  // Not in the documented list, but `::` is the IPv6 analog of 0.0.0.0,
  // which is — connecting to the unspecified address means "this host".
  if (zeroThrough(8)) return ':: (unspecified)';
  if (((groups[0] as number) & 0xfe00) === 0xfc00) return 'fc00::/7';
  if (((groups[0] as number) & 0xffc0) === 0xfe80) return 'fe80::/10';
  if (((groups[0] as number) & 0xff00) === 0xff00) return 'ff00::/8'; // multicast
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return '2001:db8::/32'; // documentation
  if (zeroThrough(5) && (groups[5] === 0xffff || groups[5] === 0)) {
    // IPv4-mapped (::ffff:a.b.c.d) or the deprecated IPv4-compatible form —
    // either way the connection target is the embedded IPv4, so judge that.
    const embedded = (groups[6] as number) * 0x10000 + (groups[7] as number);
    const range = reservedV4Range(embedded);
    if (range) return `IPv4-in-IPv6 ${range}`;
  }
  return null;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  // Cloud metadata endpoints reachable by name. metadata.google.internal is
  // already caught by the .internal suffix; listed anyway so the intent
  // survives edits to the suffix list.
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

// .localhost is not in the CLAUDE.md list but RFC 6761 reserves the whole
// TLD for loopback, which is exactly what rule 4 is about.
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localdomain', '.localhost'];

/** Rules 1–4: scheme, port, IP-literal ranges, internal-by-convention names. */
export function validateTargetUrl(raw: string): GuardVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid-url', detail: 'not a parseable absolute URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'bad-scheme', detail: 'scheme must be http or https' };
  }
  if (url.port !== '' && url.port !== '80' && url.port !== '443') {
    return { ok: false, reason: 'bad-port', detail: 'port must be 80 or 443' };
  }
  // A trailing dot ("localhost.") is the same name in DNS.
  const host = url.hostname.endsWith('.') ? url.hostname.slice(0, -1) : url.hostname;

  if (host.startsWith('[') && host.endsWith(']')) {
    const groups = parseIpv6(host.slice(1, -1));
    if (groups === null) {
      return { ok: false, reason: 'invalid-url', detail: 'unparseable IPv6 literal' };
    }
    const range = reservedV6Range(groups);
    if (range !== null) {
      return { ok: false, reason: 'private-ip', detail: `IPv6 literal in reserved range ${range}` };
    }
    return { ok: true, url };
  }

  const v4 = parseIpv4Literal(host);
  if (v4 !== null) {
    const range = reservedV4Range(v4);
    if (range !== null) {
      return { ok: false, reason: 'private-ip', detail: `IPv4 literal in reserved range ${range}` };
    }
    return { ok: true, url };
  }

  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: 'blocked-hostname', detail: 'hostname is a known internal name' };
  }
  for (const suffix of BLOCKED_SUFFIXES) {
    if (host.endsWith(suffix)) {
      return { ok: false, reason: 'blocked-hostname', detail: `hostname ends in ${suffix}` };
    }
  }
  return { ok: true, url };
}

type DohAnswer = { type: number; data: string };
type DohResponse = { Status: number; Answer?: DohAnswer[] };

const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';
const DNS_TYPE_A = 1;
const DNS_TYPE_AAAA = 28;

export type DohVerdict =
  | { ok: true }
  | { ok: false; reason: 'dns-private' | 'dns-nxdomain' | 'dns-error'; detail: string };

// In-isolate DoH verdict cache. Decision (2026-08-08): explicit carve-out
// from the "no cache of user-submitted URLs" rule — memory only, TTL-bounded,
// never logged. Amortizes the DoH pair across a batch (a single-host ZIP pays
// one pair per warm isolate, not one per image). A cached "public" verdict
// extends the rebinding window by at most the TTL — a window the per-request
// check cannot close anyway, since we still fetch by hostname.
const DOH_CACHE_TTL_MS = 60_000;
const DOH_CACHE_MAX = 256;
const dohCache = new Map<string, { expires: number; verdict: DohVerdict }>();

/** Test isolation hook; harmless in production. */
export function clearDohCache(): void {
  dohCache.clear();
}

/**
 * Resolve via DNS-over-HTTPS and reject if any A/AAAA answer is reserved.
 * Two subrequests (A and AAAA) per cache miss. Fails closed on any DoH
 * failure — a rebinding nameserver can answer NXDOMAIN here and a real
 * address to the platform resolver a moment later, so "no answer" is not a
 * pass. A clean zero-record answer is distinguished as 'dns-nxdomain' so the
 * endpoint can word it as the typo it usually is; the rejection is the same.
 */
export async function dohCheckHostname(
  hostname: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<DohVerdict> {
  const cached = dohCache.get(hostname);
  if (cached !== undefined) {
    if (cached.expires > Date.now()) return cached.verdict;
    dohCache.delete(hostname);
  }
  const verdict = await queryDoh(hostname, opts);
  // Transient failures are not cached; every other verdict is deterministic
  // on the DNS answer we just saw.
  if (verdict.ok || verdict.reason !== 'dns-error') {
    if (dohCache.size >= DOH_CACHE_MAX) {
      const oldest = dohCache.keys().next().value;
      if (oldest !== undefined) dohCache.delete(oldest);
    }
    dohCache.set(hostname, { expires: Date.now() + DOH_CACHE_TTL_MS, verdict });
  }
  return verdict;
}

async function queryDoh(
  hostname: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<DohVerdict> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let answers: DohAnswer[];
  let statuses: number[];
  try {
    const responses = await Promise.all(
      (['A', 'AAAA'] as const).map(async (type) => {
        const res = await fetchImpl(
          `${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${type}`,
          { headers: { accept: 'application/dns-json' }, signal: opts.signal },
        );
        if (!res.ok) throw new Error('DoH query failed');
        return (await res.json()) as DohResponse;
      }),
    );
    answers = responses.flatMap((r) => r.Answer ?? []);
    statuses = responses.map((r) => r.Status);
  } catch (err) {
    // Aborts must surface as timeouts to safeFetch, not as a DNS verdict.
    if (opts.signal?.aborted) throw err;
    return { ok: false, reason: 'dns-error', detail: 'DoH lookup failed' };
  }

  let sawAddress = false;
  for (const answer of answers) {
    if (answer.type === DNS_TYPE_A) {
      const ip = parseDottedQuad(answer.data);
      if (ip === null) return { ok: false, reason: 'dns-error', detail: 'malformed A record' };
      sawAddress = true;
      const range = reservedV4Range(ip);
      if (range !== null) {
        return { ok: false, reason: 'dns-private', detail: `A record in reserved range ${range}` };
      }
    } else if (answer.type === DNS_TYPE_AAAA) {
      const groups = parseIpv6(answer.data);
      if (groups === null) return { ok: false, reason: 'dns-error', detail: 'malformed AAAA record' };
      sawAddress = true;
      const range = reservedV6Range(groups);
      if (range !== null) {
        return { ok: false, reason: 'dns-private', detail: `AAAA record in reserved range ${range}` };
      }
    }
  }
  if (!sawAddress) {
    // NOERROR (0) or NXDOMAIN (3) with zero records is DNS working and saying
    // "nothing there" — usually a typo. SERVFAIL and friends stay dns-error.
    const clean = statuses.every((s) => s === 0 || s === 3);
    return clean
      ? { ok: false, reason: 'dns-nxdomain', detail: 'domain has no address records' }
      : { ok: false, reason: 'dns-error', detail: 'DNS lookup did not complete cleanly' };
  }
  return { ok: true };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SafeFetchOptions {
  /** Hard deadline for the whole chain: 10_000 for scan, 30_000 for proxy. */
  timeoutMs: number;
  init?: RequestInit;
  maxRedirects?: number;
  dohCheck?: boolean;
  /** Test seam; production always uses global fetch. */
  fetchImpl?: typeof fetch;
  dohFetchImpl?: typeof fetch;
}

/**
 * Fetch with the full guard applied to the initial URL and every redirect
 * hop. Never uses redirect:'follow' — that would let the platform hop
 * through URLs this guard never saw.
 *
 * Throws BlockedHostError, TooManyRedirectsError, or TimeoutError; any
 * other fetch failure propagates as-is.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<Response> {
  const { timeoutMs, init, maxRedirects = 3, dohCheck = true } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const dohFetchImpl = options.dohFetchImpl ?? options.fetchImpl ?? fetch;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init?.signal
    ? AbortSignal.any([timeoutSignal, init.signal])
    : timeoutSignal;
  const checkedHosts = new Set<string>();

  let current = rawUrl;
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const verdict = validateTargetUrl(current);
      if (!verdict.ok) throw new BlockedHostError(verdict.reason, verdict.detail);
      const { url } = verdict;

      // IP literals involve no DNS, so there is nothing for DoH to check.
      const isIpLiteral = url.hostname.startsWith('[') || parseIpv4Literal(url.hostname) !== null;
      if (dohCheck && !isIpLiteral && !checkedHosts.has(url.hostname)) {
        const doh = await dohCheckHostname(url.hostname, { fetchImpl: dohFetchImpl, signal });
        if (!doh.ok) throw new BlockedHostError(doh.reason, doh.detail);
        checkedHosts.add(url.hostname);
      }

      const response = await fetchImpl(url.toString(), { ...init, redirect: 'manual', signal });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        // A 3xx with no Location is not followable; hand it back unchanged.
        if (location === null) return response;
        // Free the connection — we will never read a redirect body.
        await response.body?.cancel();
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw new BlockedHostError('invalid-url', 'unparseable redirect Location');
        }
        current = next.toString();
        continue;
      }
      return response;
    }
    throw new TooManyRedirectsError(maxRedirects);
  } catch (err) {
    if (
      timeoutSignal.aborted &&
      !(err instanceof BlockedHostError) &&
      !(err instanceof TooManyRedirectsError)
    ) {
      throw new TimeoutError(timeoutMs);
    }
    throw err;
  }
}
