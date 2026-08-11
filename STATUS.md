# STATUS — imageextract.pics

Last updated: 10 August 2026

Living document. Update it at the end of each working session rather than trying to remember what state things were in.

---

## Where we are right now

**Phases 1, 2, and 4 of 8 complete; Phase 3 open on one deferred device check. Roughly 70% of the way to a launchable product.**

Phase 4 (abuse controls) closed 2026-08-10: in-isolate rate limits with the shared-egress 429 copy, the KV-read domain blocklist, the measured `limits` block with doc-sync-asserted observability, and both log close-outs — on top of the coverage diagnosis that inverted the deep-scan assumption and produced the noscript and logical-cap extraction fixes. Phases 1–3 before it shipped the engine (scan, extraction, robots, proxy, SSRF guard), the full results UI, and the download path (hotlink fallback, unified Range probing, single-image download, client-side ZIP).

Phase 5 (trust and legal): every page has shipped — `/traffic` (the renamed hard blocker), `/privacy`, `/terms` with the takedown section, and `/about` — all claim-verified before writing, none legally reviewed (Phase 7 item). **The phase stays OPEN on one item: the abuse mailbox.** Every shipped page prints an address that does not yet receive mail, and the published-promise rule holds the phase open until it flows (mechanism: Phase 7's mail-routing task). One deferred device item also remains: the post-deploy Android ZIP pass (Phase 7 list — it holds Phase 3 open).

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
- [x] Dimension probing (2026-08-10): unified Range probe (size + dimensions from one subrequest, HEAD retired client-side), Image size/Width/Height sorts restored with direction toggle and honest "n of m" counts, explicit "Measure dimensions (N)" with the allowance note past 200. Gate 33/33 incl. the transfer-stop assertion (range-ignoring 30 MB origin held to 16 KB sent).

### Open items (verification, not new code)

- [x] Device check (1): picker-path ZIP with a human in stock Chrome —
      **A2 closed 2026-08-10**: real picker witnessed, cancel mid-write
      left nothing at the chosen location; the contradiction run
      diagnosed as secure-context gating, not a bug (details in the
      Phase 3 client-zip box).
- [ ] Device check (2): mid-range Android ZIP pass — **deferred to
      post-deploy** (Phase 7 list; needs a LAN setup now, runs against
      the real https URL from any phone after deploy). Holds Phase 3
      open; the interim risk carried is recorded in the Phase 3 box.
- [x] Device check (3): Firefox click-through of the header
      view-transition — **closed 2026-08-10, run by hand.** Observed: in
      Chrome the wordmark and nav morph across the / → /results
      navigation; in Firefox the header cuts instantly with no
      animation, and the results page layout is IDENTICAL to Chrome's —
      nothing dropped alongside the transition rules. That is the
      spec-mandated degrade the view-transition commit argued for but
      could not witness (an engine without the feature drops the unknown
      at-rule and property wholesale, leaving zero behavioural CSS) —
      now witnessed in a real second engine.
- [x] Phase 2 leftover: the keyboard/focus audit — run 2026-08-10 as a
      full recorded walk, findings fixed same day. Verified (desktop
      1440×900, real Chrome): the 17 pre-grid Tab stops match the visual
      order (header → source input/clear/Re-scan → notice dismiss →
      format checkboxes → sort radio group as ONE stop with arrow-keys
      confirmed moving within → Source summary → invert switch); all
      159 tiles × 2 stops (tile + download anchor) = 318 grid stops
      reachable; the reveal-cap append fired mid-walk (120→159) with
      focus UNCHANGED and appended tiles tabbable; disabled bar buttons
      correctly skipped in the empty-selection state. Findings fixed:
      the 390px filter sheet is now a native <dialog> via showModal()
      (was aria-modal markup with no trap, no Escape, no focus move-in —
      re-walk verified: focus enters on open, 40 tabs reach ZERO page
      elements outside the dialog, Escape and Apply both close with
      focus restored to the Filters trigger, backdrop click closes,
      ::backdrop dims); selection-bar controls now carry the 2px token
      ring (were the one class on the UA default — re-verified 2px solid
      accent). Recorded observation, deliberate: the source chip signals
      focus via BORDER, not outline (design-system.md notes an
      outline-only audit will misread it).

---

## Remaining work

### Phase 1 — Core engine — **complete**

- [x] `/api/scan` endpoint with `prerender = false`
- [x] `robots.txt` fetch, parse, and enforcement (100 KB cap, wildcard/`$` support, ReDoS-safe matching)
- [x] HTMLRewriter extraction covering the full surface in AGENTS.md
- [x] `<base href>` ordering handled correctly in a streaming parser (deferred resolution)
- [x] URL normalization + dedupe
- [x] 1,000-image cap — `truncated` is a reason, `'image-cap' | 'size-cap'`, not a flag. **Re-scoped 2026-08-10:** the cap now counts LOGICAL images (a variant set counts once; variants of an admitted image are never trimmed) — candidate counting starved it on srcset-heavy pages (the coverage diagnosis's gymshark finding)
- [x] `/api/proxy` — single-image streaming pass-through, dual size caps (50 MB announced / 20 MB unannounced)
- [x] `HEAD` variant — kept server-side for external callers; **no longer the client's probing mechanism** (superseded 2026-08-10 by the unified Range probe, which answers size and dimensions in one subrequest)
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
- [x] Sort — six keys since 2026-08-10: Document order / Image size / Width / Height / Name / Type, one row per key with a direction text-toggle and "n of m" known counts (Height was dropped per the declared-dims coverage data, then RESTORED when the unified Range probe made measuring on demand cheap; unknowns sort last under both directions)
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
- [x] Lazy byte-size probing — shipped via proxy HEAD with the shared bounded queue (fetch-queue.ts, count + bytes-in-flight, the substrate ZIP reuses), then **superseded 2026-08-10 by the unified Range probe** (one prefix GET answers size AND dimensions; the gate's HEAD counting converted to Range counting). The probing discipline carried over unchanged and stays verified: 0 probes until selection, 1 per single select, cache across deselect/reselect, 5-range auto-probes / 30-range falls to the explicit action, select-all 0, peak concurrency exactly 6, bar totals never silently undercount, Cancel freezes in-flight probes. Client probe timeout 10s; data: URIs sized locally.
- [x] Single-image download — a same-origin anchor per tile (proxy download=1 for http(s); data: URIs download natively via the download attribute, no proxy). Verified in the verify:results download checks: a real file lands on disk with exact bytes; the server's disposition name wins over the anchor attribute; pointer and keyboard downloads don't toggle selection; data: downloads make zero proxy calls. Determined: a mid-stream proxy abort makes the browser discard the partial file and mark the download failed — never a silently short file.
- [x] `client-zip` streaming assembly in the browser (MIT, 2.5.0) — src/lib/zip.ts; verified by the verify:results ZIP scenarios: a real archive parsed from disk (EOCD entry count). Device pass A2 CLOSED (2026-08-10): the picker path is now witnessed by a human in stock Chrome — real picker, and **cancel mid-write left nothing at the chosen location** (the FS-Access abort contract, no longer OPFS-inferred). The same pass surfaced the secure-context boundary: `showSaveFilePicker` exists on localhost/https but NOT on a plain-http LAN address, so the run that silently saved to Downloads was the Blob path working correctly in a pickerless context ("· via browser") — activation expiry ruled out empirically (picker called 0.2–0.6 ms after click, activation active at 2 and 159 selected) and structurally (any picker rejection downloads nothing). Consequence recorded in frontend-plan: a LAN-IP device run exercises the Blob path BY CONSTRUCTION — which is the right test for the Android pass, since a phone uses the Blob path in production and the open assumption (disk-backed Blob) is a Blob-path property. **Still owed: the mid-range Android run — DEFERRED to post-deploy (2026-08-10, moved to the Phase 7 list).** Reason: it needs a LAN setup now; after deploy it runs against the real https URL from any phone anywhere — cheaper and more representative. **Risk carried in the interim:** the disk-backed-Blob assumption behind MAX_ZIP_BYTES_IN_FLIGHT stays unverified, so a large mobile ZIP could OOM the tab; the failure mode is a lost download and a reload — not data loss, not a security issue. Phase 3 stays OPEN on this one item.
- [x] Concurrency cap of 6 parallel fetches, bounding BYTES in flight, not just count — MAX_ZIP_BYTES_IN_FLIGHT 64 MB, unknowns admitted at ZIP_UNKNOWN_WEIGHT 16 MB and corrected via setWeight on response headers; a queue slot is held until the member is written, so the budget covers blob residency. Admission logic suite-tested; not re-proven in the gate.
- [x] Per-file progress — member-granularity counter ("Zipping 213/487 · 2 failed"), not intra-file bytes; verified in the gate.
- [x] Failures skipped and reported, never fatal — live counts in the bar, completion line "ZIP saved · 6 of 8 (2 skipped)", and a SKIPPED.txt member inside the archive naming each skip and reason (verified inside the downloaded bytes).
- [x] Cancel button that aborts in-flight requests — labelled "Cancel (discards ZIP)" so the consequence is known BEFORE the click; verified: cancel mid-assembly → zero download events, UI back to idle. FS-Access abort discards per the writable contract (verified against OPFS: fresh file 0 bytes, prior contents untouched).
- [x] Filename rule for the ZIP, settled with step 2 and now implemented: the archive uses MANIFEST filenames, which extract.ts already makes scan-unique (uniqueFilename appends -2, -3…; data URIs get inline-N.svg) — no assembly-time dedupe machinery needed. Single downloads use the proxy's disposition name; the browser suffixes disk collisions.
- [ ] Optional numeric prefix preserving grid order (deferred — polish toggle, not assembly)
- [x] `URL.revokeObjectURL` on every object URL — one ZIP URL alive at most, revoked after the click / on new ZIP / on unmount; gate instruments createObjectURL/revokeObjectURL and asserts 1:1.

### Phase 4 — Abuse controls

- [x] Rate limiting: 30 scans/hour, 1,000 proxy calls/hour per IP —
      in-isolate hourly counters, NOT the platform binding (its 10s/60s
      windows can't hold an hourly budget without throttling a legitimate
      500-member ZIP; DECISIONS.md "The hourly allowance is a budget").
      Verified: unit suite (window count/reset/Retry-After from window
      start, key isolation, fail-open on absent header, rejected requests
      don't extend windows); route tests (31st scan → 429 with the
      shared-egress copy, zero subrequests spent on limited calls, the
      `x-rate-limit: unenforced` canary stamps exactly when
      CF-Connecting-IP is absent); gate scenario (429 body renders in the
      error view, no retry hint).
- [x] Domain blocklist, editable without redeploy — KV read-only
      (`src/lib/blocklist.ts`; the zero-persistence carve-out and its
      reasoning in DECISIONS.md). Verified: unit suite (forgiving parse
      incl. full-URL pastes and IDN punycoding, dot-boundary broad
      match with lookalike negatives, 60s cache reads KV once per TTL,
      read failure fails open AND caches so an erroring KV isn't
      hammered); safeFetch integration (blocked initial URL rejects
      with zero fetches; a redirect INTO a blocked host dies at the
      hop); route tests (403 `domain-blocked` with the honest copy on
      BOTH endpoints, zero network). The KV namespace itself is a
      Phase 7 deploy task — until then the binding fails open.
- [x] `limits.cpu_ms` and `limits.subrequests` in `wrangler.jsonc` —
      30,000 / 100, each with its method: cpu_ms from a MEASURED worst
      case (5 MB candidate-dense document incl. 1 MB noscript through
      extract+finalize = 1,570 ms worst-of-3 on the dev machine; 50 MB
      proxy stream = 10 ms) ×4 for the stated assumption that a shared
      production core is slower than this laptop, ×~5 headroom, rounded
      generously — a too-low cpu_ms kills requests on slow colos
      undiagnosably. subrequests from the derived structural worst (61:
      page 4 + robots 4 + sheets 12 + DoH 40 + KV 1) held by a
      permanent counting test (subrequest-budget.test.ts) that fails if
      MAX_STYLESHEETS or the hop cap moves without re-derivation, and
      asserts the config keeps ≥1.5× headroom. Both values are
      doc-sync-asserted (layer 4), so a regenerated wrangler.jsonc
      fails the suite instead of deploying wrong. The
      platform-limit-fires-outside-the-taxonomy consequence is accepted
      and recorded (DECISIONS.md), with the mid-stream kill case probed
      against real Chrome: partial discarded, download marked failed —
      the truncation contract holds.
- [x] Second log close-out (Phase 4 code + CONFIG — config swept
      because the first close-out's gap was config and it bit within a
      day). Code: rate-limit.ts, blocklist.ts, api-errors.ts additions,
      both API routes, zip.ts skip changes, SelectionBar/ResultsGrid
      additions. Config: every key of wrangler.jsonc (enumerated:
      schema/compat/name/main/assets/kv/limits/observability),
      package.json scripts (wrangler types + deploy only — nothing
      logging-enabling), vitest.config.ts, astro.config.mjs (the
      session null-driver actively upholds no-persistence), env.d.ts.
      Verified: zero console.* in all of it; the two new modules never
      throw (rejections are returned verdicts — the two grep hits for
      "throw" are both comments); no interpolated URL/IP/key in any
      message; observability false now TEST-ASSERTED (doc-sync layer
      4), not remembered.
- [x] Honest User-Agent naming the tool — renamed 2026-08-10 to
      `Mozilla/5.0 (compatible; ImageExtract/1.0; +https://imageextract.pics/traffic)`
      (a user-directed fetch presenting as one — DECISIONS.md), and the
      advertised page now EXISTS (`/traffic`, Phase 5). Robots matching
      verified under the rename: token `imageextract`, name-specific
      rules honoured through scanPage (test-pinned), version-suffixed
      rules (`ImageExtract/1.0`) don't match per spec — recorded in
      DECISIONS as one half of a known silent-failure stack.
- [x] Full log audit — no page URLs, no image URLs, anywhere. Verified
      (2026-08-10, scope = all shipped code as of the coverage commit):
      zero `console.*` in src and routes; every thrown error typed with
      static/structural messages (BlockedHostError details are reason
      strings and CIDR constants, never the tripping host); all ten
      server-side `new URL()` sites guarded or safe-by-invariant; zod is
      safeParse-only; DoH failures collapse to static details. Uncaught
      rethrow measured safe ON WORKERD ONLY (probe in the workerd pool:
      "Invalid URL string.", "Network connection lost.", "internal
      error; reference = …" — no inputs echoed; Node would echo). Two
      standing findings recorded: the constraint binds CONFIG
      (observability off — AGENTS security section; enforcement comment
      lands with the wrangler limits block) and the runtime dependency
      (comment at errorResponse's rethrow). The Phase 4 code written
      AFTER this audit (rate limiter, blocklist) gets its own narrower
      sweep before the Phase 4 commit — recorded as a second close-out,
      not an extension of this one's claim.
      **Scope correction (2026-08-10):** the audit swept src/ and never
      opened wrangler.jsonc — where `observability.enabled: true` sat
      armed while Finding A claimed nothing enabled it. Disarmed the day
      it was found, before any deploy; nothing leaked. The lesson is now
      procedure: the second close-out explicitly covers CONFIG as well
      as code — wrangler.jsonc, package.json scripts, anything that can
      enable platform behaviour without a source change.
- [x] Friendly rate-limit message — the 429 copy never says "you", names
      what was exceeded, that the allowance is shared per network
      connection (carrier-NAT users can hit it having done nothing
      heavy), and when it resets (Retry-After + "about N minutes").
      Proxy-side short forms: ZIP members skipped as `rate-limit` (terse
      beside `http-502` in SKIPPED.txt, with a footer explaining those
      are retryable after reset) and the completion line names "hourly
      image limit reached". Verified by the route tests and the gate's
      429 scenario.

### Phase 5 — Trust and legal

- [x] `/traffic` UA-explainer page (renamed from the planned `/bot` —
      "bot" mischaracterised a user-directed fetch) — **shipped
      2026-08-10, the phase's hard blocker closed**. Verified: renders
      static with zero script tags in the built page, indexable (no
      robots meta), reading-measure article derived from the container
      token, wordmark-only header (the audience followed a log line and
      did not choose the product), footer-linked under Company.
      **Known consequence of the copy decision, not a defect:** the page
      deliberately does not mention robots.txt. The scanner still checks
      robots and still stops with no override — but a site owner has no
      way to learn that from us, so someone who blocks us via robots may
      assume the block failed and escalate to the abuse address. Stacked
      with the version-suffix matching rule (see DECISIONS), this is two
      silent modes a site owner can hit; the reconsideration, if it
      comes, has both halves recorded.
- [x] `/about` page — shipped 2026-08-10, claim-verified before writing
      like the other Phase 5 pages: the category sentence about
      headless-browser tools is a mechanism description naming nobody
      (one competitor confirms it in their own FAQ; the landing FAQ
      already publishes the equivalent claim); "never sit on our
      servers" is /privacy's precise wording coarsened, not
      contradicted; the JS-galleries tradeoff understates the measured
      coverage (90–100% logical on readable pages). "There won't be
      one" (accounts) is a CONSCIOUS promise — the deferred sign-in row
      was closed in the same commit, promise-first ordering recorded.
      No last-updated date: no dated promises, no changes section.
- [ ] Abuse contact address, live and monitored — **the last open
      Phase 5 item, and it holds the phase open.** Every shipped page
      prints abuse@ (and /privacy prints privacy@), so the
      published-promise rule applies: an address that receives nothing
      is a promise without a mechanism — "nothing is deployed yet"
      would have excused the dead UA URL for four phases. Mechanism:
      Phase 7's mail-routing task (one inbox, two names). Phase 5
      closes when mail FLOWS, not when pages ship.
- [x] Copyright notice above the results grid (shipped early, with the Phase 2 first pass)
- [x] Privacy policy — `/privacy` shipped 2026-08-10. **The technical
      claims are the part we can vouch for**: every checkable statement
      was verified against source before writing (probe = 4 KB Range,
      counters = kind:ip + counts, DNS cache = hostname→verdict 60s,
      no-referrer covers thumbnails, zero cookie writes + proxy strips
      upstream Set-Cookie), and two claims were REPAIRED during
      verification because the code didn't support them as drafted
      (selection triggers probes; counters store the endpoint class).
      The no-analytics sentence is mechanically guarded (doc-sync layer
      5: sentence + any analytics marker in shipped source cannot
      coexist). Last-updated derives from git at build — cannot rot
      silently. **NOT legally reviewed — a lawyer's read is owed before
      launch (Phase 7 item).**
- [x] Terms of use — `/terms` shipped 2026-08-10, same vouch-scope as
      /privacy: **product claims verified against source, NOT legally
      reviewed** (Phase 7 legal-review item names it). Verified during
      the pre-write pass: rate limits real and per-network; the
      /traffic cross-reference accurate; the storage sentence
      TIGHTENED ("Nothing you scan or download is stored" — the
      operator blocklist IS stored, and open-sourcing is on the
      deferred list, so the absolute would read as sloppy the moment
      someone finds the KV binding). The automation prohibition is
      deliberately stricter in register than the FAQ's "not yet" API
      answer — both define interactive-use-only, and the prohibition
      lets a limit-evader be refused on policy rather than debated on
      mechanism. **Coupling: if an API ever ships, the terms line and
      the FAQ answer change in the same commit.** Git-derived
      last-updated via the shared gitDateOf define.
- [x] DMCA / takedown contact — the /terms takedown section: what to
      send, to abuse@imageextract.pics, honest about the mechanism (no
      hosted copies to remove; domain exclusion where a claim is
      credible; off-site material belongs with its host). Same
      vouch-scope caveat; deliverability of the exclusion promise is
      gated on the Phase 7 KV hard blocker below.

### Phase 6 — SEO and content

- [x] Homepage copy that explains the tool (landing page shipped — truthful copy, zero JS)
- [ ] Astro content collection for tool-variant landing pages
- [ ] First 5 landing pages generated from the collection
- [ ] Our own `robots.txt` and `sitemap.xml` — **must carry `Disallow: /results`**; the meta robots tag only works if the crawler fetches the page at all
- [ ] Open Graph and Twitter card meta
- [ ] Favicon and basic brand marks
- [ ] Cloudflare Web Analytics — **coupled to /privacy**: "We use no
      analytics, advertising, or tracking services" must change in the
      SAME commit that adds this, and doc-sync layer 5 enforces exactly
      that (the beacon marker fails the suite while the sentence
      stands). Dashboard-side auto-injection bypasses the guard — check
      it by hand at deploy.
- [ ] Lighthouse pass, LCP under 2.0s on 4G
- [ ] 404 page

### Phase 7 — Deploy

- [x] GitHub repository, code pushed — verified 2026-08-10:
      `origin → github.com/qalbh/imageextract`, `main` in sync with
      `origin/main`, zero unpushed commits
- [ ] Cloudflare account created
- [ ] Nameservers moved from Hostinger to Cloudflare
- [ ] First deploy via Wrangler
- [ ] Custom domain attached, SSL verified
- [ ] **HARD BLOCKER — create the BLOCKLIST KV namespace** and replace
      the placeholder id in wrangler.jsonc. Elevated 2026-08-10 because
      /terms now PROMISES domain exclusion ("write to abuse@ and have
      your domain excluded") and the blocklist FAILS OPEN until the
      namespace exists — a deploy without it publishes a promise whose
      mechanism silently no-ops. This is the same failure the UA taught
      us two days prior: a URL advertised for four phases before the
      page existed. That is the reason the rule exists — **before a
      page goes public, every mechanism it promises must already work**
      (the rule is now standing, in AGENTS "Definition of done") — so
      the next published promise gets checked against it automatically.
- [ ] Legal review of /privacy and /terms — the copy is an accurate
      technical description, claim-verified against source; what it has
      never had is a lawyer's read. Owed before launch.
- [ ] Mail routing: provision abuse@ AND privacy@ together — one
      inbox, two names (privacy@ aliases into the abuse@ mailbox).
      Neither address is provisioned without the other: /privacy
      already prints privacy@, the footer prints abuse@, and a
      bouncing address on either page is worse than none.
- [ ] Confirm Cloudflare Web Analytics dashboard auto-injection is OFF
      — the doc-sync analytics guard covers source, not the dashboard
      (layer 5's named residual).
- [ ] Workers Paid ($5/mo) — required, free tier CPU is insufficient
- [ ] Deploy-on-push wired up
- [ ] Billing alert configured
- [ ] Anonymous error telemetry (error class only, never URLs)
- [ ] Re-scan the walled probes (lovehoney.eu, amazon, etsy, unsplash)
      from the deployed Worker. The coverage corpus ran from one network
      location and lovehoney proved geo/IP walls are vantage-dependent —
      Cloudflare's egress may land some of them in the readable class,
      which would materially change the corpus (frontend-plan.md records
      the limit). Cheap to run; the only way to answer this class.
- [ ] The mid-range Android ZIP pass (deferred here 2026-08-10 — the
      other "thing only the deployed site can answer" cheaply: any
      phone, real https URL, no LAN setup). Script in frontend-plan.
      This is the item holding Phase 3 open; it verifies the
      disk-backed-Blob assumption and retires the step-7 grid-jank box.

### Phase 8 — Post-launch

- [x] Measure real static-parse coverage across live sites — pulled forward
      and done 2026-08-10. Verified: 7 live pages (ecommerce SSR + SPA,
      news, marketing, docs anchors), headless-Chromium ground truth at one
      viewport (1440×900, DPR 1) with beacon exclusion and per-miss
      classification against the scanner-served HTML. Method, corpus table,
      and the measurement traps in frontend-plan.md.
- [x] Decide whether a deep-scan mode is justified by the data — closed:
      **not indicated**. On every readable page the truly-JS-built residue
      was 0–1 images; the real gaps were our own (noscript blindness, cap
      counting candidates), both fixed 2026-08-10. The boundary that
      remains is bot walls, which stop headless browsers too. See
      DECISIONS.md "Deep-scan mode closed".
- [ ] Monitor subrequest volume and cost for the first month
- [ ] Watch which sites produce zero results, and why
- [ ] Expand landing pages based on actual search queries

---

## Known risks

**Static parse coverage is measured, and the assumption inverted.** The feared number — "below 60% on ecommerce means the product needs rethinking" — was tested 2026-08-10 against browser ground truth on 7 live pages. SSR ecommerce lands ≥90%; news, marketing, and docs land 100% in logical images. The one sub-60% reading (a headless-React Shopify collection at 45.6%) was **our cap policy, not static parsing**: the served HTML held 2,998 image URLs the parser had already read, and the candidate-counted cap trimmed them. With the noscript and logical-cap fixes it recounts at 98.1%, and apple.com went 50% → 100% on noscript alone. No rethink is indicated. What static parsing cannot reach is what origins refuse to serve — bot walls (Anubis, challenge pages), which stop headless browsers too. Full table and method in frontend-plan.md; the closure reasoning in DECISIONS.md.

**Large-grid rendering: decided and shipped, one verification open.** The Phase 2 answer is incremental reveal (cap 120, IntersectionObserver append) plus content-visibility on fixed-ratio tiles — not virtualization, not pagination (pagination resets on filter changes and makes select-all ambiguous; see DECISIONS.md). Verified at 220 tiles under 4× CPU throttle in desktop Chrome: 120 tiles / ~1.5k DOM nodes at rest. What remains open is the real mid-range Android verification, which retires with the post-deploy ZIP device pass (deferred 2026-08-10 to the Phase 7 list — it holds Phase 3 open); @tanstack/react-virtual stays the escalation path if that device run janks.

**The proxy is a deliberately open endpoint.** Rate limits and size caps are the only defence, since verifying that a URL came from a prior scan is not possible statelessly. Accepted risk, mitigated rather than eliminated.

**DNS rebinding remains structurally open.** Workers cannot pin a connection to a validated IP. DoH narrows the window; it does not close it. Documented, not solved.

**Distribution is the real bottleneck.** The build is perhaps 20% of the work. A competitor shipped this as a side project and wins on ~60 SEO landing pages and a publishing cadence. Phase 6 is not garnish.

---

## Deferred decisions

| Decision | Trigger for revisiting |
|---|---|
| Headless-browser deep scan | **Closed 2026-08-10: not indicated.** The boundary is bot walls, not JavaScript — see DECISIONS.md. Reopens only if live-scan telemetry shows a class of *readable* pages with a large truly-absent residue |
| Sign-in or quotas | **Foreclosed 2026-08-10 by /about's published promise** ("no account, and there won't be one") — the abuse case it was reserved for is handled by rate limiting. If abuse ever outpaces that, the promise breaks publicly: /about changes FIRST, the feature second. Full reasoning in DECISIONS.md |
| Monetization | Not before real traffic exists |
| Open-sourcing | Post-launch |
| Extending to a broader toolkit | After this ships end to end |
