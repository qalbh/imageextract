# STATUS — imageextract.pics

Last updated: 10 August 2026

Living document. Update it at the end of each working session rather than trying to remember what state things were in.

---

## Where we are right now

**Phase 3 of 8. Roughly 40% of the way to a launchable product.**

Phase 2 is complete: the full results UI — token restyle, route split, faceted filters, four sorts, whole-tile selection with shift-ranges, incremental reveal, the dismissible per-scan copyright notice, and the 390px mobile pass (bottom-sheet filters) — shipped and verified. Phase 3 (download) is next, sequenced: hotlink proxy fallback → single-image download → lazy byte-size probing → client-zip assembly.

Phase 1 is complete: the whole server-side engine — scan, extraction, robots, proxy, and the security layer around all of it — is built, suite green in workerd, and verified against live sites. What remains is mostly volume rather than difficulty — with two exceptions flagged below.

### Done

- [x] Domain purchased (`imageextract.pics`, registered at Hostinger)
- [x] Architecture decided: static parse, no headless browser, zero persistence
- [x] Hosting decided: Cloudflare Workers with static assets
- [x] Astro 7 + Cloudflare adapter scaffolded, TypeScript strict
- [x] Tailwind v4 installed and verified through a production build
- [x] `AGENTS.md` / `CLAUDE.md` written — architecture, constraints, conventions
- [x] `SESSION` KV and `IMAGES` bindings removed (they contradicted no-persistence)
- [x] Vitest + `@cloudflare/vitest-pool-workers` configured, tests run in real workerd
- [x] **SSRF guard shipped** — `validateTargetUrl`, `dohCheckHostname`, `safeFetch`, all reserved ranges incl. TEST-NET/benchmarking/multicast
- [x] DNS-over-HTTPS pre-check, fail-closed, in-isolate cache, `dns-nxdomain` distinguished for typo-friendly messaging
- [x] **Phase 1 complete** — see checked list below; suite green in workerd, `tsc` clean, verified live against real sites

### In progress

- [ ] Phase 3, sequenced by dependency: hotlink proxy fallback → single-image download → lazy byte-size probing (individually-selected images only; select-all shows an em dash with an explicit "Calculate size" action) → client-zip streaming assembly. The proxy fallback and byte-probing items moved here from the Phase 2 list — they are proxy consumers, not grid work.
- [ ] Phase 2 leftover: the keyboard/focus audit (form → filters → grid focus order) was never run as a full pass; whole-tile keyboard selection and the focus ring are verified, the ordered walk-through is not.

---

## Remaining work

### Phase 1 — Core engine — **complete**

- [x] `/api/scan` endpoint with `prerender = false`
- [x] `robots.txt` fetch, parse, and enforcement (100 KB cap, wildcard/`$` support, ReDoS-safe matching)
- [x] HTMLRewriter extraction covering the full surface in AGENTS.md
- [x] `<base href>` ordering handled correctly in a streaming parser (deferred resolution)
- [x] URL normalization + dedupe
- [x] 1000-image cap — `truncated` is now a reason, `'image-cap' | 'size-cap'`, not a flag
- [x] `/api/proxy` — single-image streaming pass-through, dual size caps (50 MB announced / 20 MB unannounced)
- [x] `HEAD` variant for lazy byte-size probing
- [x] Mid-stream size abort (errors the stream — complete ⇔ body ends without error)
- [x] Error taxonomy mapped to HTTP statuses, end to end (`src/lib/api-errors.ts`)

### Phase 2 — Results UI

- [x] URL input (native GET form → `?url=`, zero JS; browser-level validation) with loading state
- [x] Results grid as a React island
- [x] Route split: `/` fully static zero-JS, island on `/results` (noindex,nofollow + query-less canonical + `no-referrer` for thumbnail privacy)
- [x] Thumbnails loaded direct from origin (the zero-cost path, `loading="lazy"`)
- [x] Dimension badges — declared dims from the manifest at first paint, upgraded to measured `naturalWidth`/`naturalHeight` on load
- [x] Type filter with live counts (faceted; grouped source filter alongside it)
- [ ] Search across filename and URL (model + tests shipped; the sidebar control was removed per the 2026-08-10 design pass — reinstating it is one input)
- [x] Sort — Document order / Width / Name / Type (height & aspect dropped per coverage data; width sorts unknowns last)
- [x] Selection state, select all, deselect all (global selection, survives filter changes)
- [x] Invert-background toggle (brought forward from Phase 9 — a white-on-transparent logo is invisible on the surface-coloured tile)
- [x] Copy selected URLs
- [x] **Incremental reveal + content-visibility** in place of full virtualization (cap 120, IntersectionObserver append; @tanstack/react-virtual escalation path if a real device janks)
- [x] Empty state (zero images found)
- [x] Error states per failure type (incl. distinct `truncated` wording per reason)
- [x] Mobile layout (390px landing + results; shared header + compact SOURCE bar on /results; sidebar becomes a bottom sheet; whole-tile keyboard selection + visible focus)
- [x] `robotsBlocked` state, no override path

### Phase 3 — Download

- [x] Proxy fallback on hotlink 403 — one retry per tile via a monotonic parent-owned status map; verified by the verify:results fallback scenario: 1 proxy request per failed tile and zero new proxy/origin requests across a filter round trip (the remount case). Live check closed (2026-08-10): referrerless 403s confirmed real across three origins; our referrerless proxy shares the failure for referer-required origins (kept deliberately — DECISIONS: impersonation argument), so its real recovery classes are CORP/ORB blocks and geo/IP splits. Full in-app loop not runnable live: image-protecting sites also page-protect, which caps the encounter rate.
- [x] Lazy byte-size probing via proxy HEAD — shipped with the shared bounded queue (fetch-queue.ts, count + bytes-in-flight, the substrate ZIP reuses). Verified by the verify:results probing scenario with server-side HEAD counting: 0 HEADs until selection, 1 per single select, cache across deselect/reselect, 5-range auto-probes / 30-range falls to "Calculate size (24)", select-all 0, peak concurrency exactly 6, bar "44.8 MB + 2 unknown" (never a silent undercount), Cancel froze 8 slow probes at 6 arrivals. Client probe timeout 10s; data: URIs sized locally.
- [x] Single-image download — a same-origin anchor per tile (proxy download=1 for http(s); data: URIs download natively via the download attribute, no proxy). Verified in the verify:results download checks: a real file lands on disk with exact bytes; the server's disposition name wins over the anchor attribute; pointer and keyboard downloads don't toggle selection; data: downloads make zero proxy calls. Determined: a mid-stream proxy abort makes the browser discard the partial file and mark the download failed — never a silently short file.
- [x] `client-zip` streaming assembly in the browser (MIT, 2.5.0) — src/lib/zip.ts; verified by the verify:results ZIP scenarios: a real archive parsed from disk (EOCD entry count). Partial device result (2026-08-10): a 120-member ZIP completed on DESKTOP via the Blob path (no picker appeared — that browser ships without the FS Access API, e.g. Brave), opened fine, no OOM. Still owed: the picker path with a human in stock Chrome/Edge (never yet exercised by anyone — the completion line now names its path so runs aren't ambiguous), and the mid-range Android pass, where the disk-backed-Blob assumption is load-bearing. Desktop memory tells us nothing about the phone.
- [x] Concurrency cap of 6 parallel fetches, bounding BYTES in flight, not just count — MAX_ZIP_BYTES_IN_FLIGHT 64 MB, unknowns admitted at ZIP_UNKNOWN_WEIGHT 16 MB and corrected via setWeight on response headers; a queue slot is held until the member is written, so the budget covers blob residency. Admission logic suite-tested; not re-proven in the gate.
- [x] Per-file progress — member-granularity counter ("Zipping 213/487 · 2 failed"), not intra-file bytes; verified in the gate.
- [x] Failures skipped and reported, never fatal — live counts in the bar, completion line "ZIP saved · 6 of 8 (2 skipped)", and a SKIPPED.txt member inside the archive naming each skip and reason (verified inside the downloaded bytes).
- [x] Cancel button that aborts in-flight requests — labelled "Cancel (discards ZIP)" so the consequence is known BEFORE the click; verified: cancel mid-assembly → zero download events, UI back to idle. FS-Access abort discards per the writable contract (verified against OPFS: fresh file 0 bytes, prior contents untouched).
- [x] Filename rule for the ZIP, settled with step 2 and now implemented: the archive uses MANIFEST filenames, which extract.ts already makes scan-unique (uniqueFilename appends -2, -3…; data URIs get inline-N.svg) — no assembly-time dedupe machinery needed. Single downloads use the proxy's disposition name; the browser suffixes disk collisions.
- [ ] Optional numeric prefix preserving grid order (deferred — polish toggle, not assembly)
- [x] `URL.revokeObjectURL` on every object URL — one ZIP URL alive at most, revoked after the click / on new ZIP / on unmount; gate instruments createObjectURL/revokeObjectURL and asserts 1:1.

### Phase 4 — Abuse controls

- [ ] Rate limiting binding: ~30 scans/hour, ~500 proxy calls/hour per IP
- [ ] Domain blocklist, editable without redeploy
- [ ] `limits.cpu_ms` and `limits.subrequests` in `wrangler.jsonc`
- [x] Honest User-Agent naming the tool — the string is **live** (sent since Phase 1) and already carries the `/bot` URL; what does NOT exist is the `/bot` page itself, which is the Phase 5 hard blocker. The split matters: the UA is advertising a URL that 404s until that page ships.
- [ ] Full log audit — no page URLs, no image URLs, anywhere
- [ ] Friendly rate-limit message

### Phase 5 — Trust and legal

- [ ] `/bot` crawler-info page — **hard dependency of the User-Agent string (`+https://imageextract.pics/bot`), must exist before the first real scan**
- [ ] `/about` page — general product/about page
- [ ] Abuse contact address, live and monitored
- [x] Copyright notice above the results grid (shipped early, with the Phase 2 first pass)
- [ ] Privacy policy (short: we store nothing)
- [ ] Terms of use
- [ ] DMCA / takedown contact

### Phase 6 — SEO and content

- [x] Homepage copy that explains the tool (landing page shipped — truthful copy, zero JS)
- [ ] Astro content collection for tool-variant landing pages
- [ ] First 5 landing pages generated from the collection
- [ ] Our own `robots.txt` and `sitemap.xml` — **must carry `Disallow: /results`**; the meta robots tag only works if the crawler fetches the page at all
- [ ] Open Graph and Twitter card meta
- [ ] Favicon and basic brand marks
- [ ] Cloudflare Web Analytics
- [ ] Lighthouse pass, LCP under 2.0s on 4G
- [ ] 404 page

### Phase 7 — Deploy

- [ ] GitHub repository, code pushed
- [ ] Cloudflare account created
- [ ] Nameservers moved from Hostinger to Cloudflare
- [ ] First deploy via Wrangler
- [ ] Custom domain attached, SSL verified
- [ ] Workers Paid ($5/mo) — required, free tier CPU is insufficient
- [ ] Deploy-on-push wired up
- [ ] Billing alert configured
- [ ] Anonymous error telemetry (error class only, never URLs)

### Phase 8 — Post-launch

- [ ] Measure real static-parse coverage across live sites
- [ ] Decide whether a deep-scan mode is justified by the data
- [ ] Monitor subrequest volume and cost for the first month
- [ ] Watch which sites produce zero results, and why
- [ ] Expand landing pages based on actual search queries

---

## Known risks

**Static parse coverage is unmeasured.** Competitors use headless browsers and find substantially more on JavaScript-heavy sites. We do not yet know our real number. If it lands below 60% on ecommerce, the product needs rethinking — and that decision is currently deferred to Phase 8. Deferring it is a choice, not an oversight.

**Large-grid rendering: decided and shipped, one verification open.** The Phase 2 answer is incremental reveal (cap 120, IntersectionObserver append) plus content-visibility on fixed-ratio tiles — not virtualization, not pagination (pagination resets on filter changes and makes select-all ambiguous; see DECISIONS.md). Verified at 220 tiles under 4× CPU throttle in desktop Chrome: 120 tiles / ~1.5k DOM nodes at rest. What remains open is the real mid-range Android verification, which retires with the Phase 3 ZIP device pass; @tanstack/react-virtual stays the escalation path if that device run janks.

**The proxy is a deliberately open endpoint.** Rate limits and size caps are the only defence, since verifying that a URL came from a prior scan is not possible statelessly. Accepted risk, mitigated rather than eliminated.

**DNS rebinding remains structurally open.** Workers cannot pin a connection to a validated IP. DoH narrows the window; it does not close it. Documented, not solved.

**Distribution is the real bottleneck.** The build is perhaps 20% of the work. A competitor shipped this as a side project and wins on ~60 SEO landing pages and a publishing cadence. Phase 6 is not garnish.

---

## Deferred decisions

| Decision | Trigger for revisiting |
|---|---|
| Headless-browser deep scan | Phase 8 coverage data |
| Sign-in or quotas | Only if abuse outpaces rate limits |
| Monetization | Not before real traffic exists |
| Open-sourcing | Post-launch |
| Extending to a broader toolkit | After this ships end to end |
