# STATUS — imageextract.pics

Last updated: 8 August 2026

Living document. Update it at the end of each working session rather than trying to remember what state things were in.

---

## Where we are right now

**Phase 2 of 8. Roughly 30% of the way to a launchable product.**

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

- [ ] Phase 2 remaining: proxy fallback on hotlink 403, lazy byte-size probing, and the mobile pass. Restyle, route split, filters, sort, selection, copy, invert-background, and incremental reveal are all shipped; results.astro is now on tokens and off the verify-gate PRE_RESTYLE list. ZIP is Phase 3.

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
- [ ] Proxy fallback on hotlink 403 (card shows "preview unavailable" for now)
- [x] Dimension badges from `naturalWidth`/`naturalHeight`
- [ ] Byte-size badges, lazy only (badge renders an em dash; probing not wired)
- [x] Type filter with live counts (faceted; grouped source filter alongside it)
- [x] Search across filename and URL (type is a filter; dimensions are the width sort)
- [x] Sort — Document order / Width / Name / Type (height & aspect dropped per coverage data; width sorts unknowns last)
- [x] Selection state, select all, deselect all (global selection, survives filter changes)
- [x] Invert-background toggle (brought forward from Phase 9 — a white-on-transparent logo is invisible on the surface-coloured tile)
- [x] Copy selected URLs
- [x] **Incremental reveal + content-visibility** in place of full virtualization (cap 120, IntersectionObserver append; @tanstack/react-virtual escalation path if a real device janks)
- [x] Empty state (zero images found)
- [x] Error states per failure type (incl. distinct `truncated` wording per reason)
- [ ] Mobile layout
- [x] `robotsBlocked` state, no override path

### Phase 3 — Download

- [ ] Single-image download through the proxy
- [ ] `client-zip` streaming assembly in the browser
- [ ] Concurrency cap of 6 parallel fetches
- [ ] Per-file progress
- [ ] Failures skipped and reported, never fatal
- [ ] Cancel button that aborts in-flight requests
- [ ] Filename sanitization and numeric-suffix dedupe
- [ ] Optional numeric prefix preserving grid order
- [ ] `URL.revokeObjectURL` on every object URL

### Phase 4 — Abuse controls

- [ ] Rate limiting binding: ~30 scans/hour, ~500 proxy calls/hour per IP
- [ ] Domain blocklist, editable without redeploy
- [ ] `limits.cpu_ms` and `limits.subrequests` in `wrangler.jsonc`
- [ ] Honest User-Agent naming the tool and linking to `/bot`
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

**An 800-image grid will not render naively.** Eight hundred DOM nodes each holding a full-resolution `<img>` will stall a mid-range phone. Needs virtualization or pagination, decided in Phase 2 rather than discovered in testing.

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
