/**
 * In-isolate hourly rate counters — politeness, not a security boundary.
 *
 * The budgets (30 scans, 1,000 proxy calls per IP per hour) come from the
 * measured session model (DECISIONS.md "The proxy allowance is politeness,
 * not cost recovery"). The platform cannot enforce an hourly budget
 * exactly: Cloudflare's Rate Limiting binding offers only 10s/60s windows,
 * and shaping 1,000/hr as ~17/min would throttle a legitimate 500-member
 * ZIP mid-assembly — the exact user the number protects. So the counters
 * live in isolate memory (the DoH-cache precedent): fixed hourly windows,
 * one Map, zero persistence, zero new bindings.
 *
 * That choice is APPROXIMATE by design, and the looseness compounds: fixed
 * windows allow a boundary straddle, each isolate counts independently
 * (one colo per user, a handful of isolates), and isolate recycling
 * forgets history mid-window. A real user's effective ceiling is a small
 * multiple of nominal — the steady-state estimate, not a worst case; there
 * is no hard ceiling. These are budgets, not guarantees (DECISIONS.md
 * "The hourly allowance is a budget the platform cannot enforce exactly").
 * The correct failure direction for a politeness control is looser.
 *
 * Nothing here logs, and no key, IP, or URL appears in any message —
 * rejection is a returned verdict, never a throw.
 */

export const RATE_LIMITS = { scan: 30, proxy: 1000 } as const;
export type RateKind = keyof typeof RATE_LIMITS;
export const RATE_WINDOW_MS = 3_600_000;
// Two entries per active IP-hour; 8,192 is far above any honest colo's
// concurrent-user count. Keys derive from CF-Connecting-IP, which the edge
// sets and clients cannot spoof through it, so the cap is a memory bound,
// not an attack surface.
const MAX_RATE_ENTRIES = 8192;

interface CounterWindow {
  windowStart: number;
  count: number;
}

const counters = new Map<string, CounterWindow>();

/** Test seam — module-level state, like clearDohCache. */
export function clearRateCounters(): void {
  counters.clear();
}

export type RateVerdict = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Count one inbound request against the (kind, ip) budget. `ip === null`
 * (header absent) admits without counting: locally and in tests there is
 * no edge to set the header, and failing open is the same politeness
 * stance as the blocklist. In production the platform contract guarantees
 * the header; the routes surface the anomalous case with a static response
 * header rather than a log line.
 */
export function checkRateLimit(kind: RateKind, ip: string | null, nowMs: number): RateVerdict {
  if (ip === null || ip === '') return { ok: true };
  const key = `${kind}:${ip}`;
  let window = counters.get(key);
  if (window !== undefined && nowMs - window.windowStart >= RATE_WINDOW_MS) {
    counters.delete(key);
    window = undefined;
  }
  if (window === undefined) {
    if (counters.size >= MAX_RATE_ENTRIES) {
      // Insertion-order eviction; expiry-on-touch keeps this path rare.
      const oldest = counters.keys().next().value;
      if (oldest !== undefined) counters.delete(oldest);
    }
    counters.set(key, { windowStart: nowMs, count: 1 });
    return { ok: true };
  }
  if (window.count >= RATE_LIMITS[kind]) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((window.windowStart + RATE_WINDOW_MS - nowMs) / 1000)),
    };
  }
  window.count += 1;
  return { ok: true };
}
