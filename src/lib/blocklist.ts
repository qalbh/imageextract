/**
 * Operator-authored domain blocklist, read from KV.
 *
 * This is the SECOND carve-out from the zero-persistence rule, recorded
 * beside the DoH verdict cache: the rule targets retention of USER data,
 * and this list holds none — it is authored by the operator, and the
 * Worker only ever READS it, so the done-when box "Nothing written to KV"
 * stays literally true (DECISIONS.md "The domain blocklist reads from KV
 * and fails open").
 *
 * Fail-open by design, and the asymmetry with the SSRF guard and DoH is
 * principled, not inconsistent: those are security and fail closed; this
 * is politeness and fails open — a KV blip must not take the tool down.
 *
 * Propagation — the number an incident responder needs: an edit is live
 * worldwide within roughly TWO MINUTES (KV eventual consistency, ≤60s
 * typical, plus this cache's 60s TTL). Treat a block as done two minutes
 * after the dashboard save, not at the save.
 */

import { env } from 'cloudflare:workers';

/** Structural KV type: trivially stubbed, no dependency on CF type packages. */
export interface BlocklistKv {
  get(key: string): Promise<string | null>;
}

export const BLOCKLIST_KEY = 'domains';
export const BLOCKLIST_TTL_MS = 60_000;

/**
 * Reads the KV binding from the workerd runtime env. NOT
 * Astro.locals.runtime.env — the adapter removed that accessor (it throws
 * a deprecation error on touch); `cloudflare:workers` is the sanctioned
 * path and resolves in production workerd, the dev platformProxy, and the
 * vitest workers pool alike. Env is typed loosely because the generated
 * type doesn't know project bindings until `wrangler types` runs against
 * a real namespace (Phase 7); an absent binding fails open as null.
 */
export function blocklistBinding(): BlocklistKv | null {
  const bindings = env as unknown as Record<string, unknown>;
  return (bindings.BLOCKLIST as BlocklistKv | undefined) ?? null;
}

let cache: { expires: number; entries: readonly string[] } | null = null;

/** Test seam — module-level state, like clearDohCache. */
export function clearBlocklistCache(): void {
  cache = null;
}

/**
 * One hostname per line; blank lines and #-comments skipped. The parse is
 * FORGIVING — scheme prefixes, paths, ports, trailing FQDN dots, and IDN
 * are all normalized rather than rejected — because a silently-dropped
 * entry is the trap the broad-match semantics exist to avoid: an operator
 * pasting a full URL mid-abuse-response must not add a no-op line.
 * Entries are punycoded via URL so they compare in the same space as
 * parsed hostnames; only truly unparseable lines are skipped.
 */
export function parseBlocklist(text: string): string[] {
  const entries: string[] = [];
  for (const line of text.split('\n')) {
    let raw = line.trim().toLowerCase();
    if (raw === '' || raw.startsWith('#')) continue;
    raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
    raw = raw.split('/')[0] as string;
    if (raw.endsWith('.')) raw = raw.slice(0, -1);
    try {
      entries.push(new URL(`http://${raw}`).hostname);
    } catch {
      // unparseable line — skipped, never fatal
    }
  }
  return entries;
}

/**
 * The broad reading, deliberately: an entry blocks itself AND every
 * subdomain — "example.com" blocks www.example.com and cdn.img.example.com
 * — because that is what an operator adding a domain during an abuse
 * response assumes. The dot boundary keeps "notexample.com" unmatched.
 * Same shape as the SSRF guard's internal-suffix checks.
 */
export function isBlockedHostname(hostname: string, entries: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return entries.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
 * Cached read of the full list. A read FAILURE also caches (as empty) so
 * an erroring KV is consulted once per TTL, not hammered per request.
 */
export async function loadBlocklist(kv: BlocklistKv, nowMs: number): Promise<readonly string[]> {
  if (cache !== null && nowMs < cache.expires) return cache.entries;
  let entries: readonly string[] = [];
  try {
    const text = await kv.get(BLOCKLIST_KEY);
    if (text !== null) entries = parseBlocklist(text);
  } catch {
    // fail open
  }
  cache = { expires: nowMs + BLOCKLIST_TTL_MS, entries };
  return entries;
}
