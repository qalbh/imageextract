# imageextract.pics

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Troubleshooting the dev server

Two failures recur and are **the default path here, not rare mishaps** — expect
them. Both are inherent to this stack (Astro background mode + the Cloudflare
adapter's workerd child + Vite's optimizer); see the DECISIONS.md entry on
workerd cleanup.

**1. Orphaned workerd after "stopping" the server.** The Cloudflare adapter
runs the Worker as a **separate `workerd` child process**. Astro's
`killDevServer` (what `astro dev stop` calls) sends SIGTERM→SIGKILL to the
**node pid only** — it never signals the process group, so workerd is orphaned
on almost every stop and keeps holding ports. This is why the port climbs
(4321→4322→…) on restarts and why `astro dev stop` eventually reports "nothing
running" while a server is very much alive. The manual `pkill` patterns people
reach for (`astro dev`, `astro/dist/cli`) match node's argv, **not** workerd's,
so they miss it. You must sweep workerd explicitly:

```
astro dev stop
pkill -9 -f "workerd serve"        # the step every other command misses
ps aux | grep -Ei "astro|workerd" | grep -v grep   # confirm nothing survives
```

**2. `deps_ssr` 500s after a dependency change.** The server 500s with
`The file does not exist at "…/node_modules/.vite/deps_ssr/…"` (sometimes
`.vite/deps/…`) after any `npm install`/`astro add`. This is Vite's dependency
optimizer holding stale hashed references — not a code problem. It is provoked
by dependency-graph churn, so **batch installs** (add several packages in one
command, not one at a time) to trigger it once instead of repeatedly. A fresh
cold start also needs **one warm-up navigation** per route before the island
renders; that first request may fail, the retry succeeds.

**Full reset — order matters:**

```
astro dev stop
pkill -9 -f "workerd serve"                          # reap workerd FIRST
ps aux | grep -Ei "astro|workerd" | grep -v grep     # verify none survive
rm -rf node_modules/.vite .astro                      # only now safe to delete
astro dev --background
```

Then hard-reload the browser. **Do not `rm -rf .astro` before confirming no
astro/workerd process is alive.** `.astro/dev.json` is the lockfile
`astro dev stop`/`status` rely on; deleting it out from under a live (or
half-stopped) server is what *causes* the desync the old recipe blamed on the
cache — the next start finds no lockfile, the old process still holds the port,
and tracking is lost. The previous version of this section deleted `.astro`
first and omitted the workerd sweep entirely, which reinstated the exact
problem on every use.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

---

## What this project is

A free web tool that takes a public webpage URL and lists every image on it, so the user can preview, filter, and download them individually or as a ZIP.

## Non-negotiable constraints

**Nothing is persisted.** No database, no KV, no R2, no D1, no cache of user-submitted URLs — sole carve-out: the in-isolate DoH verdict cache (see Security). No page URL or image URL appears in any log line. Bytes stream through and are forgotten. If a task seems to require storage, stop and ask before adding it.

**Zero persistence is not zero traffic.** Image bytes must pass through our proxy for downloads, because CORS prevents the browser from reading cross-origin image data and browsers ignore the `download` attribute on cross-origin links. The proxy is required; storage is not.

**The proxy is publicly reachable and therefore an SSRF target.** See the security section below. Treat it as the highest-risk code in the repo.

## Stack

**Status: `client-zip` and Playwright not yet installed.**

- Astro 7, TypeScript strict, Tailwind
- React only as an Astro island, and only for the interactive results grid
- Cloudflare Workers with static assets — site and API deploy as one unit
- `HTMLRewriter` for HTML parsing (built into Workers, streaming, no dependency)
- `zod` for validating query params at the Worker boundary
- `client-zip` for building ZIPs in the browser
- Vitest for unit tests, Playwright for browser tests

State the license of any new dependency when you introduce it. No AGPL.

## Architecture

Two endpoints, both stateless:

**`GET /api/scan?url=<encoded>`** — fetches the target page, parses it with `HTMLRewriter`, returns a JSON manifest of image URLs. Includes **declared** dimensions when the page states them (`<img width/height>`, srcset `w` descriptors, `og:image:width/height`, `link[sizes]`, JSON-LD) — those are free, read from bytes we already stream. No **probed** dimensions and no byte sizes: those cost subrequests and stay lazy/client-side. Typically 4 subrequests (robots.txt, the page, one DoH pair). Each redirect hop adds a fetch plus a DoH pair for a new hostname, and each linked stylesheet adds a fetch — plus a DoH pair when the sheet lives on a hostname not yet checked — bounded by the 3-redirect and 3-stylesheet caps.

**`GET /api/proxy?url=<encoded>&download=1`** — streams exactly one image. Pass the `ReadableStream` straight through; never buffer. Near-zero CPU. Worst case 12 subrequests (4 fetches across a full redirect chain plus a DoH pair per hostname); amortized ~1 per image — with the in-isolate DoH cache, a 300-image ZIP from a single host costs one DoH pair per warm isolate, not one per image. Each isolate/colo warms its own cache, so the ceiling applies to cold starts.

Everything expensive happens in the browser: previews, dimension detection, filtering, sorting, selection state, ZIP assembly.

### Manifest shape

```ts
type ScanResult = {
  pageUrl: string;
  images: Array<{
    id: string;          // stable hash of the URL
    url: string;         // absolute, resolved
    filename: string;    // derived from path, sanitized
    ext: 'png'|'jpeg'|'svg'|'gif'|'webp'|'avif'|'ico'|'unknown';
    // mirrors IMAGE_SOURCES in src/lib/extract.ts — the canonical list;
    // a doc-sync test fails if this line drifts from it
    source: 'img'|'srcset'|'picture'|'style-attr'|'style-block'|'stylesheet'|'inline-svg'|'meta'|'poster'|'favicon'|'json-ld'|'lazy'|'object'|'embed';
    // declared (unverified) dimensions when the page states them; width may
    // exist without height (a width-only srcset entry). dimensionSource
    // mirrors DIMENSION_SOURCES; doc-sync checks it. The extractor emits only
    // 'declared'; the UI renders declared values muted and flips to 'measured'
    // on load. variantGroup: shared id for every candidate of ONE logical
    // image — a whole <picture> (all its <source>s + fallback <img>) or a
    // standalone <img>'s src+srcset. Collapsing variants in the UI is deferred.
    width?: number; height?: number; dimensionSource?: 'declared' | 'measured';
    variantGroup?: string;
  }>;
  // omitted when complete. 'image-cap': whole page parsed, list trimmed.
  // 'size-cap': part of the page never parsed, images may be missing
  // entirely — size-cap wins when both fire.
  truncated?: 'image-cap' | 'size-cap';
  robotsBlocked?: true;
};
```

### Why ZIP assembly is client-side

**Status: not built.**

The browser fetches each selected image through `/api/proxy` and assembles the ZIP locally. This keeps each Worker invocation to a single subrequest, so Cloudflare's per-invocation subrequest and CPU limits never become a constraint, and a 400-image download cannot time out a Worker. Do not build ZIPs server-side.

Phase 3 design constraint, flagged early: the download concurrency cap and
the per-file size cap interact. Six concurrent fetches against the 50 MB
announced cap is 300 MB potentially in flight, which will not survive a
mid-range phone. The ZIP assembler must bound *bytes* in flight, not just
request count — e.g. by streaming each file into the archive as it arrives
rather than buffering, or by scaling concurrency down as announced sizes go
up. Not solved yet; do not design the ZIP path without addressing it.

## Cost model — memorize this

**Status: UI not built; the proxy costs (download, HEAD probing) are live server-side.**

| Feature | Where it runs | Cost |
|---|---|---|
| Thumbnail preview | `<img>` pointed directly at the origin | Zero |
| Dimension badge | `naturalWidth`/`naturalHeight` on load | Zero |
| Type filter, search, sort, select | Client state | Zero |
| Copy URLs | Clipboard | Zero |
| Byte-size badge | `HEAD` via proxy — **lazy only** | 1 subrequest (+ amortized DoH pair per hostname) |
| Download / ZIP | Proxy | 1 subrequest per image (+ amortized DoH pair per hostname) + bandwidth |

Byte-size badges must be lazy: show `—` until the user selects an image or sorts by size. Probing every image upfront on an 800-image page is the difference between a free tool and a bill.

Hotlink-protected origins will 403 the direct preview. Detect `onerror` and fall back to the proxy for that one thumbnail only.

## Security

The SSRF guard applies to **both** endpoints, on the initial URL and after
**every** redirect.

Platform note: Cloudflare Workers expose no DNS resolution API, so
"resolve the hostname and connect to the validated IP" is not implementable
here. Do not pretend otherwise. The guard is built from what IS available:

1. Scheme must be `http` or `https`
2. Reject ports outside 80 and 443
3. If the hostname is an IP literal, reject any in a reserved range:
   `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
   `169.254.0.0/16`, `100.64.0.0/10`, `0.0.0.0/8`, `192.0.2.0/24`,
   `198.51.100.0/24`, `203.0.113.0/24` (TEST-NET 1/2/3), `198.18.0.0/15`
   (benchmarking), `224.0.0.0/4` (multicast), `240.0.0.0/4` (reserved,
   subsumes `255.255.255.255`), `::` (the unspecified address — connecting
   to it means "this host"), `::1`, `fc00::/7`, `fe80::/10`,
   `2001:db8::/32`, `ff00::/8`, and IPv4-mapped IPv6 such as
   `::ffff:10.0.0.1`. Handle decimal, octal, and hex-encoded IPv4 forms —
   `2130706433` and `0x7f000001` are both localhost.
4. Reject hostnames that resolve internally by convention: `localhost`,
   anything ending `.local`, `.internal`, `.localdomain`, `.localhost`
   (RFC 6761 reserves the whole TLD for loopback), and known cloud
   metadata hostnames
5. Use `redirect: 'manual'` and follow redirects yourself, re-running the
   full guard on every hop. Maximum 3 hops. Never use `redirect: 'follow'` —
   it silently bypasses per-hop validation.
6. Hard timeouts via AbortSignal: 10s for scan, 30s for proxy

Optional hardening, decide explicitly: resolve the hostname via
DNS-over-HTTPS before fetching and reject if any A/AAAA record is in a
reserved range. Costs two extra subrequests per fetched hostname (separate
A and AAAA lookups). This narrows but does not close the DNS-rebinding
window, because we still fetch by hostname and cannot pin the connection
to a validated IP.

Decision (2026-08-05): DoH pre-check enabled, on both endpoints and on every
redirect hop, skipped for IP-literal hostnames. Actual cost is two extra
subrequests per fetched hostname (separate A and AAAA lookups). If DoH
itself fails, the request is rejected — fail closed. A clean zero-record
answer is distinguished as `dns-nxdomain` (usually a typo) and gets its own
user-facing message; the rejection is identical.

Decision (2026-08-08): in-isolate DoH verdict cache — hostname → verdict,
60 s TTL, ≤256 entries, isolate memory only, never logged. The explicit
carve-out from the no-cache rule; it amortizes the DoH pair across a
download batch. A cached "public" verdict extends the rebinding window by
at most the TTL, a window the per-request check cannot close anyway.

**Never add a Workers VPC binding or a service binding to this project.**
Those are the mechanisms that would actually give this Worker reach into
private networks.

Other limits: 100 KB cap on `robots.txt`, 5 MB cap on the fetched HTML,
cap on images per ZIP, 1,000 images per scan with a `truncated` reason.

Per-image size caps — two constants, deliberately asymmetric (mirrors
`MAX_ANNOUNCED_IMAGE_BYTES` / `MAX_STREAMED_IMAGE_BYTES` in
`src/lib/proxy.ts`). 50 MB checked against an announced `Content-Length`
before streaming begins — generous, because rejecting there is free; nothing
has been transferred. 20 MB abort threshold for bodies with no
`Content-Length` — tighter, because by the time it fires the 200 and headers
are already sent and every byte is paid for; an unannounced body that large
is a mistake or someone using us as a pipe. A body exceeding its own
announced length is aborted at the announced length. Aborts **error** the
stream, never close it cleanly: a complete download is exactly one whose
body stream ends without error, which is how the client (and later
`client-zip`) tells truncated from complete.

The proxy must reject non-image `Content-Type`, and must set
`X-Content-Type-Options: nosniff` plus `Content-Disposition: attachment`
when `download=1`.

Sanitize filenames on download: strip path separators, control characters,
and leading dots; cap length; deduplicate with a numeric suffix.

## Politeness

**Status: robots enforcement and the honest User-Agent are live; rate limits and user-facing notices not built.**

- Respect `robots.txt` before scanning. On a block, return `robotsBlocked` and show "This site has asked automated tools not to access this page." **No override button.**
- Honest User-Agent naming the tool with a URL explaining it.
- Rate limit by IP: roughly 30 scans/hour, 500 proxy calls/hour.
- Copyright notice above the results grid; abuse contact in the footer.

## Extraction surface

`<img src>` is a small fraction. Resolve everything against `<base href>`, then absolute:

`img[src]`, `img[srcset]`, `source[srcset]` in `<picture>`, lazy attributes (`data-src`, `data-lazy-src`, `data-original`, `data-srcset`, `data-bg` — note these appear on `<div>` as well as `<img>`), inline `style="background-image:url()"` and `image-set()`, `<style>` blocks, linked stylesheets (cap at 3), `video[poster]`, `<object data>`, `<embed src>`, inline `<svg>` (serialize the element; there is no URL), `link[rel~=icon]` and `apple-touch-icon`, `og:image` and `twitter:image` meta, JSON-LD `image` fields.

Then dedupe by normalized URL (strip fragment, sort query params) and drop `data:` URIs over 100 KB.

## Code conventions

- Errors are typed and enumerated, never bare strings: `BlockedHostError`, `TimeoutError`, `TooManyRedirectsError`, `SizeLimitError`, `NotAnImageError`, `UpstreamHttpError`. Each maps to a specific user-facing message and HTTP status in `src/lib/api-errors.ts`. No catch-all "Something went wrong." A robots block is not an error — it is a successful scan of a page we were asked not to read, returned as a 200 manifest with `robotsBlocked`.
- Astro pages ship zero JavaScript by default. Add `client:*` directives only to the results grid.
- Comments explain *why* — a spec quirk, a workaround for a class of malformed page — not *what*.
- Every `URL.createObjectURL` has a matching `revokeObjectURL`.

## Keeping docs and code in sync

`src/lib/doc-sync.test.ts` mechanically guards three things: the manifest
unions (`source`, `truncated`) match `extract.ts`; every code identifier
named in the docs (constants, error classes, enum literals) exists in
source; and the design-system colour table matches the `@theme` block. A
rename or a wrong value fails the suite.

What it deliberately does **not** check is prose numbers — a caps figure
like "100 KB on `robots.txt`" or "10s scan timeout" stated in a sentence.
Asserting a number appears near a word confirms a string, not that the
sentence still describes the code, and the false confidence is worse than
the gap. **Standing rule: prose claims are read against the code at the end
of each phase** (the phase-boundary audit), not machine-checked. The three
drifts that prompted this — an undocumented cache, a stale cost line, a
non-existent enum value — were all found by reading, and two of the three
were semantic, which no string test can see.

## Design system

`src/styles/global.css` is the sole source of color, type, spacing, and
radius values — components consume tokens, never raw values. If a value you
need is not present, raise it before adding it; do not introduce hex codes,
ad-hoc sizes, or arbitrary-value utilities in components. Full rules and
the token table: `docs/design-system.md`.

## SEO

**Status: not built.**

Traffic is the entire acquisition channel, so this is an architectural concern rather than a marketing afterthought. Every tool variant gets its own statically generated page with real explanatory copy, generated from a content collection. Budget: LCP under 2.0s on 4G.

## Definition of done

- [ ] SSRF guard unit-tested against every reserved range, including a redirect chain into one
- [ ] Nothing written to KV, R2, D1, or cache
- [ ] No URLs in logs
- [ ] `robots.txt` respected with no override path
- [ ] Rate limits live before public launch
- [ ] Byte-size probing verified lazy by counting network calls on a large page
- [ ] Preview falls back to proxy on hotlink 403
- [ ] Large ZIP completes on a mid-range Android phone
- [ ] `limits` block set in `wrangler.jsonc`
- [ ] Copyright notice and abuse contact shipped

## How to work with me

- If a requirement is ambiguous in a way that changes the architecture, ask before building.
- Plan first for anything non-trivial. Wait for confirmation before writing code.
- Name the tradeoff on every recommendation — one line on what it costs.
- If my approach is worse than an alternative, say so before building it.
- Complete, runnable code. No placeholders or "rest of implementation" comments.
- I am new to this stack. Explain unfamiliar concepts briefly when they come up, without being asked.