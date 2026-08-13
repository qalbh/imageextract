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

**Nothing is persisted.** No database, no KV, no R2, no D1, no cache of user-submitted URLs — two carve-outs: the in-isolate DoH verdict cache (see Security), and the operator domain blocklist read from KV (see Politeness). The distinction that keeps both honest: this rule targets retention of USER data. The blocklist is operator-authored, holds no user data, and is only ever READ by the Worker — "nothing written to KV" stays literally true. No page URL or image URL appears in any log line. Bytes stream through and are forgotten. If a task seems to require storage, stop and ask before adding it.

**Zero persistence is not zero traffic.** Image bytes must pass through our proxy for downloads, because CORS prevents the browser from reading cross-origin image data and browsers ignore the `download` attribute on cross-origin links. The proxy is required; storage is not.

**The proxy is publicly reachable and therefore an SSRF target.** See the security section below. Treat it as the highest-risk code in the repo.

## Stack

**Status: `client-zip` installed (MIT, 2.5.0). playwright-core is installed and drives the verify gates.**

- Astro 7, TypeScript strict, Tailwind
- Preact via `@astrojs/preact` with compat — the island is written as React-flavoured JSX but ships Preact's runtime (see DECISIONS.md); one island only, the interactive results grid
- Cloudflare Workers with static assets — site and API deploy as one unit
- `HTMLRewriter` for HTML parsing (built into Workers, streaming, no dependency)
- `zod` for validating query params at the Worker boundary
- `client-zip` for building ZIPs in the browser
- Vitest for unit tests (in real workerd); playwright-core for the browser verify gates (verify:landing, verify:results)

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
    // standalone <img>'s src+srcset. Collapsing variants in the UI is
    // deferred but OWED — correctness, not polish (DECISIONS: "Coverage
    // counts logical images"). The scan cap counts variantGroup units.
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

**Status: built (`src/lib/zip.ts`); mid-range-device verification pending.**

The browser fetches each selected image through `/api/proxy` and assembles the ZIP locally. This keeps each Worker invocation to a single subrequest, so Cloudflare's per-invocation subrequest and CPU limits never become a constraint, and a 400-image download cannot time out a Worker. Do not build ZIPs server-side.

The bytes-in-flight constraint flagged early (six concurrent fetches × the
50 MB announced cap = 300 MB in the air) is solved by the shared queue's
byte budget: members admit against `MAX_ZIP_BYTES_IN_FLIGHT` (64 MB — the
working is in the constant's comment), unknown-size members at
`ZIP_UNKNOWN_WEIGHT` (16 MB) corrected via setWeight the moment response
headers arrive, and a queue slot is held until the member is WRITTEN into
the archive so the accounting covers blob residency, not just open streams.
Per-ZIP member cap `MAX_ZIP_IMAGES` (500 — half the 1,000/hr allowance,
pinned, moves with it) is rate-budget coherence, not memory — see its
comment. The load-bearing ASSUMPTION, tested by the device
pass: the accumulating Blob archive is disk-backed on target browsers; if a
browser holds it in memory, that — not transport — is the OOM path.
Failures are skipped and reported twice (live counts in the bar; a
SKIPPED.txt member inside the archive). Cancel discards: the Blob path never
started a download, and the FS-Access writable's abort discards per the
contract (verified empirically against OPFS: 0 bytes on a fresh file, prior
contents untouched).

## Cost model — memorize this

**Status: the results UI is built (Phase 2 complete); its two proxy consumers — the hotlink fallback and byte-size probing — plus downloads/ZIP are Phase 3. The proxy's server side (inline GET, download=1, HEAD) is live.**

| Feature | Where it runs | Cost |
|---|---|---|
| Thumbnail preview | `<img>` pointed directly at the origin, lazy-loaded | Zero |
| Dimension badge | Declared dims from the manifest at first paint (free — read from bytes we already streamed), upgraded to measured `naturalWidth`/`naturalHeight` on load | Zero |
| Filters (format, source), sort, select | Client state | Zero |
| Copy URLs | Clipboard | Zero |
| Byte-size + dimension probe | one prefix `Range` GET via proxy — **lazy only**; Content-Range's total gives bytes, the file header gives exact dimensions | 1 subrequest for BOTH (+ amortized DoH pair per hostname) |
| Download / ZIP | Proxy | 1 subrequest per image (+ amortized DoH pair per hostname) + bandwidth |

Two client-side mechanisms change what "zero cost" means at scale, on both
sides of the wire: the **reveal model** (120 tiles mounted initially,
IntersectionObserver appends; with content-visibility, off-screen tiles skip
rendering) and lazy `<img>` loading together mean an 800-image scan renders
cheaply AND fetches only viewport thumbnails — not 800 requests against the
origin on render. The **icon-source contain rule** (favicon, inline-svg render
contain at natural size; everything else covers the 262:180 well) is a display
rule with no network cost, recorded here because it is why tiny rasters don't
get upscaled.

Probing is lazy and **individually user-initiated** (decided 2026-08-10)
and UNIFIED (also 2026-08-10): one prefix Range GET answers byte size AND
exact dimensions — a size probe measures dimensions for free and vice
versa, which is why the client's HEAD probe was retired (the server HEAD
variant stays for external callers). Single toggles and shift-ranges
spanning ≤ `PROBE_AUTO_LIMIT` (24 — a generous screenful; larger ranges
are the same burst class as select-all) probe through a capped, abortable
queue (`PROBE_CONCURRENCY` 6, client timeout `PROBE_TIMEOUT_MS` 10s).
**Select-all and invert probe nothing** — the total renders an em dash
with an explicit "Calculate size (N)" action, and the dimension sorts
(Image size / Width / Height) offer "Measure dimensions (N)" the same way;
past `MEASURE_WARN_AT` (200) the count carries an hourly-allowance note,
because past a couple hundred requests a bare count under one click is no
longer informed consent — the rationale is BURST SIZE, and the number
deliberately does not move with the allowance (it coincided with ~40% of
the originally planned 500/hr; the coincidence, not the threshold, is
what changed at 1,000). A bulk click would otherwise be an N-request burst, and
a concurrency cap only spreads a burst out rather than preventing it.
data: URIs never probe — size and dimensions are computed locally. A
range-ignoring origin gets its stream cancelled after the prefix (gate
asserts the transfer stops at kilobytes). Selection and the explicit
actions are the only triggers. Probing every image upfront on an
800-image page is the difference between a free tool and a bill.

Hotlink-protected origins will 403 the direct preview. Detect `onerror` and
fall back to the proxy for that one thumbnail only — the aggregate is bounded
by lazy loading plus the reveal cap, so a fully protected page costs viewport
tiles, not the whole manifest.

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

**"No URLs in logs" binds configuration, not just code** (log audit,
2026-08-10). The inbound request URL embeds the scanned page URL
(`/api/scan?url=…`), so enabling Workers Logs / observability / Logpush
would log every user's URL with zero code changes. Observability stays
OFF; if it is ever wanted, it ships only after URL redaction is verified.
The `wrangler.jsonc` limits block carries this rule as a comment at the
exact spot someone would flip it. Relatedly, the audit measured that
uncaught-error hygiene is a RUNTIME property: workerd genericizes error
messages ("Invalid URL string." — input not echoed); the same code on
Node would log the user's URL. The dependency is recorded at
`errorResponse`'s rethrow.

Other limits: 100 KB cap on `robots.txt`, 5 MB cap on the fetched HTML,
`MAX_ZIP_IMAGES` (500) per ZIP, 1,000 **logical** images per scan (a
variant set counts once; variants of an admitted image are never trimmed)
with a `truncated` reason. The ceiling on manifest ENTRIES is therefore
`MAX_RAW_CANDIDATES` (5,000) — and that is a **transfer-size bound, not a
rendering one**: the reveal cap mounts 120 tiles regardless of manifest
length, so the only cost of a big manifest is the JSON crossing the wire.
Measured on the worst real page found (2,731 entries): 899 KB raw, 67 KB
gzipped — acceptable on a phone connection; extrapolated to the full 5,000
ceiling ≈ 1.6 MB raw / ~125 KB wire, still acceptable, so the ceiling
stands.

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

Determined empirically (2026-08-10, mid-stream probe against Chromium): when
a browser-owned download's stream errors mid-body — what the proxy's abort
produces — the browser **discards the partial file and marks the download
failed** (headless reports "canceled"; headed Chrome shows a failed entry in
the download shelf). The user never receives a silently short file, and
nothing can or needs to be done client-side once the anchor navigation has
handed the download to the browser.

The proxy must reject non-image `Content-Type`, and must set
`X-Content-Type-Options: nosniff` plus `Content-Disposition: attachment`
when `download=1`.

Sanitize filenames on download: strip path separators, control characters,
and leading dots; cap length; deduplicate with a numeric suffix.

## Politeness

**Status: robots enforcement and the honest User-Agent string are live, and
the /traffic explainer page the UA links to EXISTS (Phase 5 hard blocker
closed 2026-08-10 — the UA was renamed the same day:
`Mozilla/5.0 (compatible; ImageExtract/1.0; +https://imageextract.pics/traffic)`,
a user-directed fetch presenting as one, robots token `ImageExtract` —
DECISIONS.md "The User-Agent presents as a user-directed fetch"). Rate
limits and the 429 notices are built (in-isolate counters,
`src/lib/rate-limit.ts`), as is the domain blocklist
(`src/lib/blocklist.ts`, KV namespace created at Phase 7) and the
wrangler `limits` block — Phase 4 abuse controls are complete.**

- Respect `robots.txt` before scanning. On a block, return `robotsBlocked` and show "This site has asked automated tools not to access this page." **No override button.**
- Operator domain blocklist (`src/lib/blocklist.ts`, KV key `domains`,
  one hostname per line): an entry blocks the host and EVERY subdomain
  (dot-boundary suffix — the reading an operator mid-abuse-response
  assumes); IDN entries are punycoded and full-URL pastes forgiven at
  parse. Enforced inside `safeFetch` per hop, so it covers both
  endpoints, every redirect hop, robots, and stylesheet fetches — and
  image URLs on a blocked host keep dying after a scan, because the
  proxy re-checks per call. Fail-open (KV blip ≠ outage; security
  fails closed, politeness fails open) and deliberately enumerable —
  a 403 `domain-blocked` with honest copy (DECISIONS.md). An edit is
  live worldwide within ~2 minutes (KV consistency + 60s cache TTL).
- Honest User-Agent naming the tool with a URL explaining it:
  `Mozilla/5.0 (compatible; ImageExtract/1.0; +https://imageextract.pics/traffic)`.
  The `USER_AGENT` string and the robots `UA_TOKEN` (`imageextract`) live
  together in scan.ts and MOVE TOGETHER — matching keys on the token, not
  the string (test-pinned through scanPage).
- Rate limit by IP: 30 scans/hour, 1,000 proxy calls/hour (decided
  2026-08-10 from the measured session model — DECISIONS.md "The proxy
  allowance is politeness, not cost recovery"). **Nominal budgets,
  enforced per isolate** (`src/lib/rate-limit.ts`: fixed hourly windows,
  in-isolate counters — the platform's rate-limit binding offers only
  10s/60s windows): a real user's effective ceiling is a small multiple
  of nominal, and there is no hard ceiling — budgets, not guarantees
  (DECISIONS.md "The hourly allowance is a budget"). The 429 copy must
  account for shared egress: many users can sit behind one carrier-NAT
  or campus IP, so it must not accuse, and should say the limit is
  shared by the network connection and when it resets — the copy lives
  in `rateLimitResponse`.
- Copyright notice above the results grid; abuse contact in the footer.

## Extraction surface

`<img src>` is a small fraction. Resolve everything against `<base href>`, then absolute:

`img[src]`, `img[srcset]`, `source[srcset]` in `<picture>`, lazy attributes (`data-src`, `data-lazy-src`, `data-original`, `data-srcset`, `data-bg` — note these appear on `<div>` as well as `<img>`), inline `style="background-image:url()"` and `image-set()`, `<style>` blocks, linked stylesheets (cap at 3), `video[poster]`, `<object data>`, `<embed src>`, inline `<svg>` (serialize the element; there is no URL), `link[rel~=icon]` and `apple-touch-icon`, `og:image` and `twitter:image` meta, JSON-LD `image` fields.

**And `<noscript>` content, re-parsed through the same pipeline.** This is
not scraping cleverness, and whoever later suspects it of being overreach
should read this twice: noscript is the site's own answer to non-JS user
agents, and a static HTML scanner IS a non-JS user agent. It is content
addressed to us that we were throwing away — half of apple.com's rendered
images existed statically nowhere else (measured 2026-08-10, coverage
diagnosis). HTMLRewriter parses with scripting assumed on, so noscript
arrives as raw text; the fragments are collected (bounded by
`MAX_NOSCRIPT_TEXT`) and recurse once through `extractFromHtml` — same
handlers, no duplicated logic, markup occurrences winning dedupe ties.

Then dedupe by normalized URL (strip fragment, sort query params) and drop `data:` URIs over 100 KB.

## Code conventions

- Errors are typed and enumerated, never bare strings: `BlockedHostError`, `TimeoutError`, `TooManyRedirectsError`, `SizeLimitError`, `NotAnImageError`, `UpstreamHttpError`, `UpstreamNetworkError` (the server answered badly vs. never answered — both typed; a dead host is not a raw 500). Each maps to a specific user-facing message and HTTP status in `src/lib/api-errors.ts`. No catch-all "Something went wrong." A robots block is not an error — it is a successful scan of a page we were asked not to read, returned as a 200 manifest with `robotsBlocked`.
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

It is **not** a dumping ground for component rules. Tokens, fonts, `body`,
and cross-document view transitions live there; view-specific CSS lives with
its view (`src/styles/results.css`, imported by `results.astro`) or its
component (a scoped `<style>` in the `.astro` file). The rule and the
mechanism that made it leak are in `docs/design-system.md` → "Where CSS
lives"; verify:landing enforces it.

## SEO

**Status: not built.**

Traffic is the entire acquisition channel, so this is an architectural concern rather than a marketing afterthought. Every tool variant gets its own statically generated page with real explanatory copy, generated from a content collection.

**Budget: LCP under 2.1s on 4G — revised 2026-08-11 from 2.0s.** The old
number was never measured against production transport: every Lighthouse
run before that date was served by `python -m http.server`, which sends
everything UNCOMPRESSED, and the landing page read 2.2–2.3s. Re-measured
against a compressing server (the harness rule below), the same build gives
**LCP 2.03s, performance 99, CLS 0, FCP 1.2s** on Lighthouse's mobile
slow-4G profile; /results gives 1.65s at 100. So the real gap to the old
budget was 29ms, not 250.

Those 29ms were **not** bought back by shrinking bytes. Removing 2.5 KB of
misplaced CSS from the critical path (the /results split, same day) moved
LCP by **1 millisecond** — 2029 → 2030ms. The residual is latency-bound:
Lighthouse attributes 302ms of render-blocking cost to a **1,259-byte**
stylesheet, which is the round trip to discover and fetch it, not its
transfer. Only inlining critical CSS could close it, and that buys 29ms in
exchange for a build step, a duplication risk, and a file that silently
rots when the CSS changes. 2.1s is the honest line for "the page is fast";
a budget revised with its reasoning is honest, a budget quietly missed is
drift. **Do not re-attempt byte reduction against this number** — that
mistake has already been made twice here (a font subset and a CSS audit),
both times because the measurement understated the product.

## Releasing

Releases are a direct deploy from a local machine, never deploy-on-push
(DECISIONS.md "Releases are a direct wrangler deploy" — the gates need a
real Chromium that a push-triggered build would not run).

1. Build the feature
2. `npm test` · `npx astro check` · `npm run verify:landing` ·
   `npm run verify:results`
3. Commit
4. `npm run build && npx wrangler deploy`
5. **Verify the deployed site, not just the build**

Step 4 runs from the repo root and deploys the ADAPTER-GENERATED config,
not `wrangler.jsonc` — the build writes `dist/server/wrangler.json` and
points wrangler at it through `.wrangler/deploy/config.json`. Expect
"Using redirected Wrangler configuration" in the output; that line is
correct, not a warning. `wrangler.jsonc` is the input it is generated
from, and two of its values are rewritten in the output — the full note,
including why `assets.directory: "./dist"` does not mean the server
bundle ships as a public asset, is at the top of `wrangler.jsonc` where
someone would be misled by it.

Two operational notes from the first deploy, both cost time:
`npx wrangler login` is an interactive browser flow, so it needs a human
at the keyboard; and after attaching a new hostname, a local resolver may
hold a NEGATIVE DNS cache from before the record existed (SOA negative
TTL here is 1800s), so `curl` fails while the domain is fine — confirm
against `dig @1.1.1.1` or the authoritative nameservers, and use
`curl --resolve` / Chrome's `--host-resolver-rules` to verify before
propagation catches up. A cold resolver is not a broken deploy.

**Step 5 is not ceremony, and step 2 does not cover it.** Verifying the
build tells you what you produced; only the deployment tells you what a
visitor receives. The platform is between the two, and it edits the
response.

Proven at the first custom-domain attach (2026-08-12): Cloudflare Web
Analytics auto-injection put a `cloudflareinsights.com` beacon into
every page — while `/privacy` served "We use no analytics, advertising,
or tracking services." Nothing in the repo could have caught it. The
source was clean, doc-sync layer 5 passed, and layer 5's own test names
this as the one path it cannot cover. It was invisible to every local
check because zone features do not apply to `*.workers.dev`, so the same
Worker was clean on one hostname and not the other — it could ONLY
appear at the moment the hostname joined the zone. It was also invisible
to `curl`: injection is gated on browser-like request headers, so a
header-less fetch showed zero script tags while a browser showed one.

So step 5 means: fetch the real hostname, with browser-like headers, and
read what came back. Check status codes rather than "it renders", count
script tags rather than trusting the build's count, and confirm the
promises each page makes are still true of the bytes being served.

**After every deploy, check the RENDERED HTML for injected third-party
scripts.** Not the build, not `curl` with default headers — both were
clean while production was not. Concretely, either:

- fetch each page with a browser `User-Agent` **and** `Accept:
  text/html`, and grep the response for `cloudflareinsights`,
  data-cf-beacon, `/cdn-cgi/`; or better,
- load each page in a real browser and assert **zero requests to any
  host other than the site's own** — that catches injection by any
  mechanism, not just the one script tag you thought to grep for.

The second is what finally proved the beacon gone (7/7 pages, zero
third-party requests, live script counts identical to the build's
1/0/0/0/0/2/0). Cloudflare features that can inject: Web Analytics,
Rocket Loader, Email Obfuscation, Bot Fight Mode — all zone/account
settings, none visible in this repo, all able to appear without a
deploy. Which is the real point: **this check is owed after a
CONFIGURATION change too, not only after a code deploy.**

## Definition of done

**When marking a done-when box, record what was actually verified — not a
restatement of the box text.** "Verified: 220 tiles at 4× CPU throttle in
desktop Chrome" can be audited; a bare [x] next to "smooth on a mid-range
Android phone" cannot. Both overclaims reopened at the Phase 2 boundary came
from the same mechanism: the person writing the checklist was the person
satisfying it, and "verified keyboard selection" became "verified focus
order" without anyone lying. The fix is procedural, not attentional — state
the evidence, and the gap between it and the box text stays visible.

**Look before recording a negative.** Computed styles describe one
mechanism; an affordance built by another mechanism reads as absent. The
2026-08-10 keyboard audit twice recorded "no focus ring" from
`outline: none` on elements whose ring was a border — the screenshots
corrected the probe. A negative claim ("this has no X") needs eyes on the
rendered thing, not just a property read.

**A measurement harness that understates the product is worse than
none.** For four days every performance number here was measured against
`python -m http.server`, which does not compress; the landing page's
critical path read ~61 KB instead of ~13 KB and LCP read 2.2–2.3s instead
of 2.03s. A quarter-second of phantom regression drove a font-subset
experiment that could not have worked and nearly drove a CSS-inlining
one. Lighthouse 12 had been reporting the cause the whole time — its
uses-text-compression audit scored 0 with 50 KiB of named savings in
every report — and nobody read that row; Lighthouse 13 has removed the
audit entirely, so the report will not say it again. The fix is therefore
structural, not attentional: `scripts/static-server.mjs` is the ONLY way
to serve `dist/client` outside workerd (`npm run serve:dist` for a
Lighthouse run), both verify gates use it, and verify:landing ASSERTS
that what it received was compressed. Generally: before trusting a
measurement, check that the harness resembles production in the dimension
you are measuring — and make the resemblance mechanical, not a habit.

**When a decision makes a top-level claim conditional, the claim moves
in the SAME commit as the decision.** Recording the deviation elsewhere
is not enough. DECISIONS is where you look if you already suspect
something; the done-criteria is where you look to find out whether to
suspect. Found twice in one pass (2026-08-12): "Nothing written to KV"
survived the blocklist carve-out, so a reader who greps `wrangler.jsonc`,
finds a KV namespace, and reads the absolute would reasonably conclude
the claim was broken; and "Rate limits live" survived the decision that
they are in-isolate budgets with no hard ceiling — and never mentioned
that limiting is off entirely without `CF-Connecting-IP`. Both
deviations were correctly recorded in DECISIONS and in the modules. Both
top-level claims were still wrong, and a claim nobody has reason to
doubt is the one that never gets checked.

**A published promise needs its mechanism live.** Before a page goes
public, every mechanism it promises must already work. Two instances,
both caught late: the User-Agent advertised its explainer URL for four
phases while the page 404'd, and /terms promised domain exclusion while
the blocklist's KV namespace was a deferred deploy task the code fails
OPEN without. Check every new public page's promises against running
code before it ships — the check is part of writing the page, not a
launch-day sweep.

- [x] SSRF guard unit-tested against every reserved range, including a
      redirect chain into one — `src/lib/ssrf-guard.test.ts`: 33 tests,
      61 reserved-range assertions covering the full AGENTS list
      (loopback/private/link-local/CGNAT/TEST-NET 1-3/benchmarking/
      multicast/reserved, the IPv6 set, IPv4-mapped, and the decimal,
      octal and hex encodings). The redirect case is explicit and is
      the one that matters: "rejects a redirect chain whose final hop
      is a private IP, WITHOUT FETCHING IT", plus the same for a
      decimal-encoded private IP
- [x] Nothing written to KV, R2, D1, or cache — **no user data is
      persisted anywhere**, which is the clause the rule was always
      protecting. Verified by search: no `.put`/`.write` to any binding
      exists in shipped source; the only `.delete` calls are in-memory
      `Map` evictions (DoH verdict cache, rate counters, fetch queue,
      selection state). The one binding, BLOCKLIST, is **read-only
      operator config** — `blocklist.ts` calls `kv.get` and nothing
      else, and the list holds no user data, so it sits OUTSIDE this
      rule's scope rather than being an exception to it. Worded this
      way because a reader who greps `wrangler.jsonc`, finds a KV
      namespace, and reads the old absolute would reasonably conclude
      the claim was broken
- [x] No URLs in logs — zero `console.*`/`logger.*` calls in shipped
      server code, backed by TWO audits that found different things.
      Audit 1 (code, record.md "Full log audit") cleared every log site.
      Audit 2 (config, record.md "Second log close-out") is the one to
      cite: **the config sweep found `observability.enabled` ARMED
      while audit 1 claimed nothing enabled it — audit 1 swept `src/`
      and never opened `wrangler.jsonc`.** Disarmed the day it was
      found and now test-pinned (doc-sync layer 4 asserts
      `observability.enabled === false`, so a regenerated or
      pasted-over config fails the suite). One runtime dependency,
      recorded at `errorResponse`'s rethrow: workerd genericises
      uncaught error messages ("Invalid URL string." — input not
      echoed); the identical code on Node would log the user's URL
- [x] `robots.txt` respected with no override path — enforced in
      `scan.ts` (a block returns a 200 manifest with
      `robotsBlocked: true` and an empty list, not an error); no
      `override`/`force`/`ignoreRobots`/`bypass` parameter exists in
      the scan path or either API route
- [x] Rate limits live — wired into BOTH endpoints (`scan.ts:21`,
      `proxy.ts:21`), `RATE_LIMITS = {scan: 30, proxy: 1000}` per
      fixed 1-hour window, 24 unit tests. **What is actually enforced,
      stated here rather than left in the module:** counters are
      IN-ISOLATE, so a real ceiling is a small multiple of nominal and
      there is NO hard cap — these are budgets, not guarantees
      (DECISIONS "The hourly allowance is a budget"). And limiting is
      OFF ENTIRELY if `CF-Connecting-IP` is absent, surfaced by an
      `x-rate-limit: unenforced` response header (a canary that logs
      nothing) — **checked live in production 2026-08-12: header
      absent, so the edge is setting the IP and limiting is
      enforced**
- [x] Byte-size probing verified lazy by counting network calls on a
      large page — verify:results, 220-tile fixture: "zero probes on
      load and render" (0), "select-all probes nothing" (0), an
      oversized shift-range probes nothing and offers "Calculate size
      (24)", and Calculate size probes each remaining image exactly
      once with queue peak ≤ 6
- [x] Preview falls back to proxy on hotlink 403 — verified by the
      verify:results fallback scenario (1 proxy request per failed tile;
      zero re-requests across a filter round trip). Live check closed
      2026-08-10: referrerless 403s are real (three origins), and for
      referer-required origins the referrerless proxy fails too — its real
      recovery classes are CORP/ORB blocks and geo/IP splits (DECISIONS:
      "The proxy stays referrerless")
- [x] Large ZIP completes on a mid-range Android phone — run 2026-08-13
      against the live https site. **Observed and reported: a large
      selection was zipped on a real Android phone and the archive
      downloaded successfully.** That is the whole of the evidence, and
      the box is checked on exactly it.
      **Not reported, therefore not claimed:** the device, the number of
      images selected, the archive's byte size, whether the tab survived
      assembly without reloading, and whether the archive opened with the
      expected member count. The disk-backed-Blob assumption behind
      `MAX_ZIP_BYTES_IN_FLIGHT` is SUPPORTED but not settled by this —
      how strongly depends on the archive size, which is the unstated
      number (reasoning in STATUS Phase 3). Written this way because the
      box text is "completes", the report says it completed, and
      everything else a reader would assume from a tick is absent
- [x] `limits` block set in `wrangler.jsonc` — verified: cpu_ms 30,000
      from a measured 1,570 ms local worst case with the hardware
      assumption stated beside the number; subrequests 100 over a
      derived worst of 61, held by the counting test in
      `subrequest-budget.test.ts`; both values and observability=false
      asserted by doc-sync layer 4, so a regenerated file fails the
      suite
- [x] Copyright notice and abuse contact shipped — notice above the
      results grid (`ResultsGrid.tsx`, "Images belong to their
      creators. Only download what you have the right to use."),
      restated in the landing FAQ, and the contact
      (support@imageextract.pics) in the landing footer plus /traffic,
      /terms, /about and /privacy. "Shipped" is true rather than merely
      present as of 2026-08-12: the address RECEIVES MAIL, verified
      from an external account

## How to work with me

- If a requirement is ambiguous in a way that changes the architecture, ask before building.
- Plan first for anything non-trivial. Wait for confirmation before writing code.
- Name the tradeoff on every recommendation — one line on what it costs.
- If my approach is worse than an alternative, say so before building it.
- Complete, runnable code. No placeholders or "rest of implementation" comments.
- I am new to this stack. Explain unfamiliar concepts briefly when they come up, without being asked.