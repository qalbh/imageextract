# Record — closed work and the evidence for it

Companion to `STATUS.md`. **STATUS carries what is OPEN; this file carries
what closed and what was actually verified.** The split happened 2026-08-12,
when STATUS had reached 753 lines of which 586 were closed boxes and 37 were
open ones — a 16:1 dilution that had made the ledger fail at finding twice in
one day (a summary line contradicting its own checklist 370 lines below it,
and an owed item with no box at all).

**The rule that keeps this working: a box that closes MOVES here, with its
evidence, in the same commit that closes it.** STATUS's length then tracks
REMAINING work and shrinks as the project finishes, instead of growing fastest
when most is being achieved. `doc-sync.test.ts` layer 6 asserts STATUS holds no
closed boxes, so this is enforced rather than remembered.

Entries are verbatim as they were written in STATUS — the move edited nothing,
because a move that also edits is a move nobody can verify. They are ordered by
the section they lived in, and they keep their original dates and wording,
including entries that record their own corrections.

Nothing here is read to plan. It is read at an audit, or when someone asks
"was X verified, and how?" — which is the question it answers well.

---

## Done

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

## Open items (verification, not new code)

- [x] Device check (1): picker-path ZIP with a human in stock Chrome —
      **A2 closed 2026-08-10**: real picker witnessed, cancel mid-write
      left nothing at the chosen location; the contradiction run
      diagnosed as secure-context gating, not a bug (details in the
      Phase 3 client-zip box).
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

## Phase 1 — Core engine — **complete**

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

## Phase 2 — Results UI

- [x] URL input (native GET form → `?url=`, zero JS; browser-level validation) with loading state
- [x] Results grid as a React island
- [x] Route split: `/` fully static zero-JS, island on `/results` (noindex,nofollow + query-less canonical + `no-referrer` for thumbnail privacy)
- [x] Thumbnails loaded direct from origin (the zero-cost path, `loading="lazy"`)
- [x] Dimension badges — declared dims from the manifest at first paint, upgraded to measured `naturalWidth`/`naturalHeight` on load
- [x] Type filter with live counts (faceted; grouped source filter alongside it)
- [x] Search across filename and URL — **capability shipped and tested**
      (`query` in `FilterState`, `matchesQuery`); the sidebar CONTROL was
      then deliberately removed in the 2026-08-10 design pass and the
      island passes `''`. **Checked rather than left blank, per the
      deploy-on-push precedent: an unchecked box reads as owed work, and
      this is a design decision, not a gap.** Reinstating the input is one
      component change if the design pass ever reverses.
- [x] Sort — six keys since 2026-08-10: Document order / Image size / Width / Height / Name / Type, one row per key with a direction text-toggle and "n of m" known counts (Height was dropped per the declared-dims coverage data, then RESTORED when the unified Range probe made measuring on demand cheap; unknowns sort last under both directions)
- [x] Selection state, select all, deselect all (global selection, survives filter changes)
- [x] Invert-background toggle (brought forward from Phase 9 — a white-on-transparent logo is invisible on the surface-coloured tile)
- [x] Copy selected URLs
- [x] **Incremental reveal + content-visibility** in place of full virtualization (cap 120, IntersectionObserver append; @tanstack/react-virtual escalation path if a real device janks)
- [x] Empty state (zero images found)
- [x] Error states per failure type (incl. distinct `truncated` wording per reason)
- [x] Mobile layout (390px landing + results; shared header + compact SOURCE bar on /results; sidebar becomes a bottom sheet; whole-tile keyboard selection + visible focus)
- [x] `robotsBlocked` state, no override path

## Phase 3 — Download

- [x] Proxy fallback on hotlink 403 — one retry per tile via a monotonic parent-owned status map; verified by the verify:results fallback scenario: 1 proxy request per failed tile and zero new proxy/origin requests across a filter round trip (the remount case). Live check closed (2026-08-10): referrerless 403s confirmed real across three origins; our referrerless proxy shares the failure for referer-required origins (kept deliberately — DECISIONS: impersonation argument), so its real recovery classes are CORP/ORB blocks and geo/IP splits. Full in-app loop not runnable live: image-protecting sites also page-protect, which caps the encounter rate.
- [x] Lazy byte-size probing — shipped via proxy HEAD with the shared bounded queue (fetch-queue.ts, count + bytes-in-flight, the substrate ZIP reuses), then **superseded 2026-08-10 by the unified Range probe** (one prefix GET answers size AND dimensions; the gate's HEAD counting converted to Range counting). The probing discipline carried over unchanged and stays verified: 0 probes until selection, 1 per single select, cache across deselect/reselect, 5-range auto-probes / 30-range falls to the explicit action, select-all 0, peak concurrency exactly 6, bar totals never silently undercount, Cancel freezes in-flight probes. Client probe timeout 10s; data: URIs sized locally.
- [x] Single-image download — a same-origin anchor per tile (proxy download=1 for http(s); data: URIs download natively via the download attribute, no proxy). Verified in the verify:results download checks: a real file lands on disk with exact bytes; the server's disposition name wins over the anchor attribute; pointer and keyboard downloads don't toggle selection; data: downloads make zero proxy calls. Determined: a mid-stream proxy abort makes the browser discard the partial file and mark the download failed — never a silently short file.
- [x] `client-zip` streaming assembly in the browser (MIT, 2.5.0) — src/lib/zip.ts; verified by the verify:results ZIP scenarios: a real archive parsed from disk (EOCD entry count). Device pass A2 CLOSED (2026-08-10): the picker path is now witnessed by a human in stock Chrome — real picker, and **cancel mid-write left nothing at the chosen location** (the FS-Access abort contract, no longer OPFS-inferred). The same pass surfaced the secure-context boundary: `showSaveFilePicker` exists on localhost/https but NOT on a plain-http LAN address, so the run that silently saved to Downloads was the Blob path working correctly in a pickerless context ("· via browser") — activation expiry ruled out empirically (picker called 0.2–0.6 ms after click, activation active at 2 and 159 selected) and structurally (any picker rejection downloads nothing). Consequence recorded in frontend-plan: a LAN-IP device run exercises the Blob path BY CONSTRUCTION — which is the right test for the Android pass, since a phone uses the Blob path in production and the open assumption (disk-backed Blob) is a Blob-path property. **Still owed: the mid-range Android run — DEFERRED to post-deploy (2026-08-10, moved to the Phase 7 list).** Reason: it needs a LAN setup now; after deploy it runs against the real https URL from any phone anywhere — cheaper and more representative. **Risk carried in the interim:** the disk-backed-Blob assumption behind MAX_ZIP_BYTES_IN_FLIGHT stays unverified, so a large mobile ZIP could OOM the tab; the failure mode is a lost download and a reload — not data loss, not a security issue. Phase 3 stays OPEN on this one item.
- [x] Concurrency cap of 6 parallel fetches, bounding BYTES in flight, not just count — MAX_ZIP_BYTES_IN_FLIGHT 64 MB, unknowns admitted at ZIP_UNKNOWN_WEIGHT 16 MB and corrected via setWeight on response headers; a queue slot is held until the member is written, so the budget covers blob residency. Admission logic suite-tested; not re-proven in the gate.
- [x] Per-file progress — member-granularity counter ("Zipping 213/487 · 2 failed"), not intra-file bytes; verified in the gate.
- [x] Failures skipped and reported, never fatal — live counts in the bar, completion line "ZIP saved · 6 of 8 (2 skipped)", and a SKIPPED.txt member inside the archive naming each skip and reason (verified inside the downloaded bytes).
- [x] Cancel button that aborts in-flight requests — labelled "Cancel (discards ZIP)" so the consequence is known BEFORE the click; verified: cancel mid-assembly → zero download events, UI back to idle. FS-Access abort discards per the writable contract (verified against OPFS: fresh file 0 bytes, prior contents untouched).
- [x] Filename rule for the ZIP, settled with step 2 and now implemented: the archive uses MANIFEST filenames, which extract.ts already makes scan-unique (uniqueFilename appends -2, -3…; data URIs get inline-N.svg) — no assembly-time dedupe machinery needed. Single downloads use the proxy's disposition name; the browser suffixes disk collisions.
- [x] `URL.revokeObjectURL` on every object URL — one ZIP URL alive at most, revoked after the click / on new ZIP / on unmount; gate instruments createObjectURL/revokeObjectURL and asserts 1:1.

- [x] Large ZIP completes on a mid-range Android phone — run 2026-08-13
      against the live https site, closing the item that had held Phase 3
      open since 2026-08-10 and had accumulated three homes before the
      2026-08-12 consolidation.
      **What was observed and reported, verbatim in scope:** a large
      selection was zipped on a real Android phone, and the archive
      downloaded successfully.
      **What was NOT reported and is therefore not claimed here:** the
      device, the selection size, the archive's byte size, whether the tab
      survived assembly without reloading, whether the archive opened with
      the expected member count, and grid scroll behaviour (that half stays
      open in STATUS — the same run would have exercised it, but nobody
      said, and inferring it is the failure this rule exists to stop).
      **Effect on the disk-backed-Blob assumption behind
      `MAX_ZIP_BYTES_IN_FLIGHT`: supported, not settled.** The end-to-end
      path is now known to work on real mobile hardware, which retires the
      "does this even function on a phone" question. It does not validate
      the assumption at the scale where it is load-bearing, because the
      in-flight budget (64 MB) bounds CONCURRENT transfer while the OOM
      path scales with the TOTAL accumulated archive — and the total is the
      one number not reported. An archive comfortably inside a tab's memory
      headroom would complete identically whether the Blob was disk-backed
      or not, so it cannot discriminate. The discriminating evidence is an
      archive large enough that holding it in RAM would fail.
      **Size supplied 2026-08-13: the archive was 10 MB — INCONCLUSIVE, and
      recorded as such rather than tidied into a tick.** The constant's own
      working puts the tab at killable beyond ~500 MB, so 10 MB is about 2%
      of the discriminating threshold; the run completes identically in both
      worlds. `zip.ts` keeps its ASSUMES wording and now carries this
      negative result beside it, so nobody re-runs a small ZIP and reads it
      as settlement. Settling it needs one archive of a few hundred MB.
- [x] Grid scroll smoothness on a real phone — reported 2026-08-13:
      **smooth**, on the same Android run, at the image count that produced
      a 10 MB archive. That count was never stated, so what is established
      is real-device smoothness at a modest scale, not at the 1,000-image
      figure frontend-plan step 7 phrases the criterion around.
      **Closed anyway, and the architecture is why**: `TILE_REVEAL_CAP`
      mounts 120 tiles regardless of manifest length, with
      `content-visibility` skipping off-screen work, so what scrolling costs
      is bounded by the reveal window rather than by the total. Manifest
      size changes how many times the append fires, not how much DOM exists
      at rest. Desktop had this at 220 tiles under 4× CPU throttle; a real
      phone now has it at an unstated but real count. The residual — many
      repeated appends over a 1,000-image manifest — is a risk in Known
      risks, not an open box, and `@tanstack/react-virtual` remains the
      escalation if it ever surfaces.

- [x] Optional numeric prefix preserving grid order — **CLOSED as
      NOT-DOING 2026-08-13, a decision rather than outstanding work**, and
      checked rather than left blank for the deploy-on-push reason: an
      unchecked box reads as owed. Full reasoning in DECISIONS.md
      ("Numeric filename prefixes in the ZIP: closed as not-doing").
      In short: `uniqueFilename` already makes manifest filenames
      scan-unique, so a prefix would solve ORDERING rather than collisions;
      the ordering it preserves is document order, which is where an image
      sat in the markup and not something users act on; and it would spend
      sidebar surface — already carrying format, sort, source and display
      groups — on filename cosmetics nobody has asked for. Revisit if
      someone actually asks, which is the only evidence that would justify
      it. **This was the last open box in Phase 3, which closes with it.**

## Phase 4 — Abuse controls

Phase 4 (abuse controls) closed 2026-08-10: in-isolate rate limits with the shared-egress 429 copy, the KV-read domain blocklist, the measured `limits` block with doc-sync-asserted observability, and both log close-outs — on top of the coverage diagnosis that inverted the deep-scan assumption and produced the noscript and logical-cap extraction fixes. Phases 1–3 before it shipped the engine (scan, extraction, robots, proxy, SSRF guard), the full results UI, and the download path (hotlink fallback, unified Range probing, single-image download, client-side ZIP).

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

## Phase 5 — Trust and legal

Phase 5 (trust and legal) **CLOSED 2026-08-12**: every page shipped — `/traffic` (the renamed hard blocker), `/privacy`, `/terms` with the takedown section, and `/about` — all claim-verified before writing, none legally reviewed (still a Phase 7 item). The phase was held open on the abuse mailbox alone, correctly: every page prints the address, and the published-promise rule does not accept a page whose mechanism is pending. It closed when mail FLOWED — support@imageextract.pics verified receiving from an external account. One deferred device item remains elsewhere: the post-deploy Android ZIP pass (Phase 7 list — it holds Phase 3 open).

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
- [x] Abuse contact address, live and monitored — **CLOSED
      2026-08-12, and with it PHASE 5.** Mail to
      support@imageextract.pics was sent from an external account and
      confirmed arriving in the Hostinger mailbox; the record split
      (Hostinger mailbox, Cloudflare-hosted DNS, Email Routing
      deliberately OFF) is in the Phase 7 mail-routing item.
      The phase was held open on this alone, and the reason stands as
      the general case: every shipped page prints the address, so the
      published-promise rule applies — an address that receives nothing
      is a promise without a mechanism, and "nothing is deployed yet"
      would have excused the dead UA URL for four phases. Phase 5
      closed when mail FLOWED, not when the pages shipped.
      **Superseded 2026-08-12: the one-inbox-two-names plan is dead.**
      It provisioned abuse@ and privacy@ as two names aliasing into one
      mailbox. There is now ONE address — support@imageextract.pics —
      carrying abuse, privacy, and takedown alike. One live mailbox
      beat two names over a mailbox that did not exist yet, and a
      single address cannot rot half-way: with two names, one alias
      silently failing leaves a page printing a bouncing address while
      the other page looks fine.
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
      send, to support@imageextract.pics, honest about the mechanism (no
      hosted copies to remove; domain exclusion where a claim is
      credible; off-site material belongs with its host). Same
      vouch-scope caveat; deliverability of the exclusion promise is
      gated on the Phase 7 KV hard blocker below.

## Phase 6 — SEO and content

- [x] Homepage copy that explains the tool (landing page shipped — truthful copy, zero JS)
- [x] Our own `robots.txt` and `sitemap.xml` — shipped 2026-08-11.
      robots.txt carries `Disallow: /results` (with the why in a
      comment) and `Disallow: /api/`, plus the Sitemap line.
      @astrojs/sitemap (MIT, build-time only — zero runtime bytes)
      generates sitemap-index + sitemap-0 with exactly the five public
      pages: /results filtered out, **/traffic explicitly in** (its
      main discovery route after the log line itself). Verified in the
      built output, not the config.
- [x] Open Graph and Twitter card meta — in Layout.astro with per-page
      title/description props (the slot-meta pattern retired — it was
      double-printing descriptions). og:image is an ABSOLUTE URL
      (verified in built HTML), declared 1200×630; the file shipped is
      a 2× source (2400×1260, 158,944 bytes, ratio verified exact).
      `site` set in astro.config. The image is meta-only: Lighthouse's
      network log confirms it never loads on the page itself.
- [x] Favicon and basic brand marks — favicon.svg (mark, token-exact
      colours), a regenerated multi-size favicon.ico (32+16, replacing
      Astro's stale default — deleting would 404 legacy clients
      forever), and logo.svg (the full lockup) replacing the header's
      tile+text pair. All three inspected before wiring: no scripts,
      rasters, or external refs; fills are frozen copies of
      --color-accent/--color-text (exact match — a token change must
      re-export). vt-wordmark stays on the anchor, so the header morph
      is unchanged; 390px verified no-wrap (203×25 natural in a 58px
      header).
- [x] Cloudflare Web Analytics — **CLOSED as NOT-DOING (2026-08-12): a
      decision, not outstanding work.** Checked rather than left blank
      for the deploy-on-push reason — an unchecked box reads as owed,
      and this is the opposite of owed.
      Enabling it would make a published sentence false: /privacy serves
      "We use no analytics, advertising, or tracking services", and
      doc-sync layer 5 fails the suite while that sentence and any
      analytics marker coexist. This is not hypothetical — the beacon
      WAS live and that sentence WAS false on the deployed site for
      roughly an hour on 2026-08-12, when attaching the custom domain
      triggered account-level auto-injection. Full incident, including
      the dashboard path where the setting actually lives (account
      level, NOT the zone toggle that reported it disabled throughout),
      in the Phase 7 item below.
      **If analytics are ever wanted, the order is fixed** and it is the
      /about-promise order: /privacy changes first, in the same commit,
      with the doc-sync guard updated deliberately — never the beacon
      first. Dashboard-side injection bypasses the guard entirely, which
      is why the rendered-HTML third-party check is now owed after every
      deploy AND after configuration changes (AGENTS.md → Releasing).
- [x] Lighthouse pass — **PASSES the budget, and the budget was
      REVISED to 2.1s (2026-08-11) with the old 2.0s figure and the
      reason recorded here and in AGENTS.md → SEO.** Final measurement,
      taken against the shipped tree with the compressing harness
      (Lighthouse 13.4.1, mobile slow-4G simulated throttling,
      production build, served by `npm run serve:dist`): **/ = LCP
      2,030ms, performance 99, FCP 1,207ms, CLS 0; /results = LCP
      1,654ms, performance 100, FCP 1,204ms, CLS 0.**
      **Why 2.1s and not "inline the CSS and keep 2.0".** The residual
      is 29ms and it is latency-bound. Removing 2,559 bytes of
      misplaced CSS from the critical path the same day (the /results
      split below) moved LCP from 2,029ms to 2,030ms — one
      millisecond, inside the noise. Lighthouse charges **302ms** of
      render-blocking cost to a **1,259-byte** stylesheet: that is the
      round trip, not the transfer. Inlining critical CSS is the only
      thing that would close it, and it buys 29ms for a build step, a
      duplication risk, and a file that rots silently when the CSS
      changes. 2.0s was a proxy for "the page is fast"; at 2.03s /
      perf 99 / CLS 0 the page is fast. Revised deliberately, with the
      arithmetic, rather than left as a quiet miss.
      The earlier history is kept below because two experiments were
      run against a broken harness and the record should show that.
      **Superseded first measurement (Lighthouse 12): / scored 98 with
      LCP 2.2–2.3s; /results 99 with LCP 2.0s; CLS 0.** Not from the
      new brand assets: og-image never loads (meta-only,
      network-log-confirmed) and a logo-blocked counterfactual moved
      LCP ~0.1s.
      **The font hypothesis was TESTED AND FALSIFIED (2026-08-11) —
      conclusion stands, MAGNITUDES ARE UNVERIFIABLE.** A 2,152-byte
      hero subset (19 glyphs, instanced at 700 from the same variable
      file, inlined by Vite so it cost zero requests) was built, wired
      to the H1, and measured: LCP 2.3s with both fonts preloaded —
      identical to baseline — and 2.5s when the full face's preload was
      dropped. Both of those runs were UNCOMPRESSED (see the artefact
      below), so the absolute numbers are wrong. The finding survives
      anyway, because it is a *comparison within one harness*: subset
      and baseline were measured the same broken way and came out
      identical, which is what "zero gain" means. It was REVERTED
      rather than kept as neutral-but-maintained (it would have needed
      regeneration on every hero-copy change). CLS stayed 0 throughout;
      the subset never shipped, so the two-face swap question is moot.
      Not re-measured on the fixed harness: the fix removes bytes from
      the critical path, and the critical path is now known to be
      latency-bound, so the experiment has less headroom than when it
      already showed none.
      **THE MEASUREMENT ARTEFACT (found 2026-08-11 while auditing the
      CSS payload) — the finding that invalidated the two figures
      above.** Every Lighthouse run before this point was served by
      `python -m http.server`, which sends everything UNCOMPRESSED;
      Lighthouse 12's uses-text-compression audit scored 0 and named
      50 KiB of savings, in every report, unread. (Lighthouse 13 has
      removed that audit — the report will not say it again, which is
      why the fix had to be structural.) Cloudflare compresses by
      default, so the production critical path is ~13 KB, not ~61 KB.
      Re-measured against a compressing server (same build, same
      throttled profile): **/ = LCP 2.03s, perf 99; /results = LCP
      1.65s, perf 100; CLS 0 on both; FCP 1.2s (was 1.8s)** — a
      phantom 250ms of regression, gone. **Closed structurally:**
      `scripts/static-server.mjs` is now the only way to serve
      `dist/client` outside workerd (brotli/gzip by negotiation, like
      Cloudflare), both verify gates use it, `npm run serve:dist` is
      the documented Lighthouse harness, and verify:landing asserts
      the bytes it received were compressed — 2 new checks, green.
      **What the CSS audit found (no bundling bug):** `SiteHeader.css`
      is not the header's CSS — it is the whole site's global sheet,
      named after the first component in the import graph that pulls
      `global.css` (Layout imports it; Vite names the shared chunk).
      22.5 KB raw = **5.7 KB gzip / 4.9 KB brotli**, composed of
      Tailwind preflight 3.7 KB, all 152 site-wide utilities 10.2 KB
      (the header itself uses 12), the token layer 1.5 KB, `@property`
      registrations 1.1 KB, and 6.0 KB of hand-written global rules
      (fonts, view transitions, and ~1.6 KB of results-only component
      CSS that every page then carried — moved out, see below). The
      `@theme` block is emitted ONCE — index.css shares zero rules with
      it — and the radius namespace wipe holds (no `rounded-lg/xl`,
      only the three named values; the sole numeric survivors are
      `mt-0`/`p-0`, both genuinely used). So the payload is correctly
      sized and there was nothing to un-duplicate.
- [x] Results-only CSS moved out of the global sheet (2026-08-11) —
      `src/styles/results.css`, imported by `results.astro`; ScanForm's
      `.source-input` moved to a scoped `<style>` in its own component.
      Shared sheet 22,483 → **19,924 B** raw (5,007 B gzip, 4,346 B
      brotli); `/results` carries the moved rules as a 2,676 B inline
      `<style>` (Astro inlines page CSS under 4 KB — zero extra
      request); `/privacy`, `/terms`, `/about`, `/traffic` and `/404`
      now carry 86–89 B of inline CSS each and **zero** results rules.
      The bytes were never the point: `/privacy` shipping the results
      grid's styles meant the global/component boundary was not
      holding. **What let it leak** — Preact islands cannot use Astro's
      scoped `<style>`, so island CSS must live in an unscoped sheet,
      and `global.css` was the only one that existed; each rule landed
      there for a locally correct reason. The fix is the missing home,
      not vigilance. Recorded in docs/design-system.md → "Where CSS
      lives" and enforced by two new verify:landing checks (a leak into
      `/privacy` fails; so does `/results` losing a rule). Both gates
      re-run green afterwards: landing 16/16, results 34/34, suite 366,
      `astro check` 0 errors.
- [x] 404 page — shipped 2026-08-11: same shape as the static pages
      (wordmark-only header, reading measure, tokens), zero script
      tags in the built 404.html, says the page doesn't exist and
      links home. Excluded from the sitemap automatically.

- [x] Astro content collection for tool-variant landing pages — shipped
      2026-08-12 (`610e6c8`). `src/content.config.ts` + `src/pages/tools/`,
      one `.md` per page; route, sitemap entry, meta, token enforcement and
      gate coverage are automatic, so the marginal cost of page sixty is a
      file rather than code. The schema encodes four rules (a mandatory
      limits entry; exactly one evidenced headline claim; no verbatim
      restatement of a landing-page sentence; no backticks in fields that
      render as text) and `content-claims.test.ts` walks every claim's
      evidence. The `assumes` mechanism is the novel part: a page declares
      which symbol's ARRIVAL invalidates its copy, and the test asserts
      absence — proven in both directions by simulation, not assumed.
      Verified: verify:landing 25/25 with a per-tool-page loop,
      verify:results 34/34, suite 393, `astro check` clean, both new pages
      in the built sitemap with no config change.
      **This box was stale within four hours of being written** — it read
      as open all morning while the work landed at midday. It is the
      measured instance behind the ledger warning's latency note.

- [x] First 5 landing pages generated from the collection — shipped
      2026-08-12. `/tools/download-png-images` (format), `download-svg-images`
      (format + the inline-SVG differentiator), `download-favicon` (source),
      `download-og-image` (source), `download-shopify-product-images`
      (use case). **Spread across all three axes deliberately**: with no query
      data yet, five pages on one axis would only have reported on that axis;
      the first Search Console read says which axis earns the next fifty-five.
      Every claim carries a code symbol or a corpus row and is checked by
      `content-claims.test.ts` (61 assertions across the five). Two pages
      declare an `assumes` dependency on `collapseVariants` being unbuilt, so
      variant collapse will turn the suite red naming the paragraphs to
      rewrite. Verified: verify:landing 25/25 + 8 per page, zero script tags on
      each, funnel params carried into /results on every page, titles and
      descriptions unique, all six pages in the built sitemap.
      Two honesty fixes made during the build rather than after: the meta-bucket
      funnel lands wider than the favicon and OG titles imply (stated as a limit
      on both), and the PNG page's claims shipped visible backticks in the built
      HTML, which produced the schema's fourth rule.
      **DEPLOYED and verified live 2026-08-13, version `bd53514f`** — step 5
      run against the real hostname, not the build. All 13 pages 200 (404 for
      a miss), zero third-party requests from a real browser on every one, and
      live script counts identical to the build's (/ = 1, /results = 2, the
      other eleven 0), so nothing is being injected. The funnel was walked
      end to end on production: the PNG page's form lands on
      `/results?format=png&url=…` and the sidebar renders PNG TICKED — 1 of 21
      images shown, the other formats one click away. That is the visible,
      removable form the funnel decision requires, confirmed by screenshot
      rather than inferred from the URL. Live sitemap carries all 11 public
      URLs; robots.txt still disallows /results and /api/.

## Phase 7 — Deploy

- [x] GitHub repository, code pushed — verified 2026-08-10:
      `origin → github.com/qalbh/imageextract`, `main` in sync with
      `origin/main`, zero unpushed commits
- [x] Cloudflare account created — 2026-08-12,
      account `c9ad2f8b45e26aea20600e1121b19a7f`, wrangler
      authenticated via OAuth (`workers_kv:write` in scope, which the
      KV item below needed)
- [x] Nameservers moved from Hostinger to Cloudflare — verified by
      `dig NS`: `elle.ns.cloudflare.com` / `leif.ns.cloudflare.com`,
      SOA on Cloudflare. Nothing stale came back from the Hostinger
      parking setup: the apex held NO records before the attach and
      `www` has zero.
- [x] First deploy via Wrangler — 2026-08-12, version
      `6ac71823-4056-4ff9-87ca-97ce19aaec21`. **What shipped was
      measured, not assumed:** 38 files, all from `dist/client`, zero
      `.md`/`.ts`/`.astro`/`.test.*`/`.map`; the "read 46 / uploaded
      38" gap reconciled (six subdirectories, plus `_headers` and
      `.assetsignore` consumed rather than served). Worker startup
      24–28 ms; 636.69 KiB total, 166.16 KiB gzipped.
- [x] Custom domain attached, SSL verified — `imageextract.pics`, as a
      Custom Domain rather than a route pattern (the hostname belongs
      entirely to this Worker; reasoning in wrangler.jsonc), declared
      in config rather than clicked so it is version-controlled.
      Cert: CN=imageextract.pics, Google Trust Services, 2026-08-11 →
      2026-11-09, `ssl_verify=0`, HTTP/2. DNS created by the attach:
      A `104.21.82.69` + `172.67.197.187`, AAAA
      `2606:4700:3031::6815:5245` + `2606:4700:3030::ac43:c5bb`.
      `workers_dev` pinned false in the same pass — a second hostname
      serving identical indexable content is duplicate content.
- [x] **HARD BLOCKER — BLOCKLIST KV namespace — CLOSED 2026-08-12.**
      Namespace `b4ef65c2b3e346eaa02dca44e839468a` created at the first
      deploy and set in wrangler.jsonc, replacing the placeholder.
      /terms' exclusion promise is deliverable from now on: an empty
      namespace blocks nothing (every lookup is a clean miss), but
      honouring a request is now an operator adding a line, live
      worldwide in ~2 minutes — not a redeploy. doc-sync layer 4 still
      passes, verified rather than assumed: it asserts the BINDING
      NAME, so a changed id does not trip it while a deleted binding
      still does. Original reasoning kept below.
      Elevated 2026-08-10 because
      /terms now PROMISES domain exclusion ("write to support@ and have
      your domain excluded") and the blocklist FAILS OPEN until the
      namespace exists — a deploy without it publishes a promise whose
      mechanism silently no-ops. This is the same failure the UA taught
      us two days prior: a URL advertised for four phases before the
      page existed. That is the reason the rule exists — **before a
      page goes public, every mechanism it promises must already work**
      (the rule is now standing, in AGENTS "Definition of done") — so
      the next published promise gets checked against it automatically.
- [x] Mail routing — **CLOSED 2026-08-12: support@imageextract.pics
      receives mail, verified by sending from an external account and
      confirming arrival in the mailbox.**
      **The mechanism, plainly, because the split is confusing:** the
      MAILBOX is Hostinger's; the DNS RECORDS live in the Cloudflare
      zone, because DNS authority moved to Cloudflare while mail
      hosting stayed put. In the zone: MX mx1/mx2.hostinger.com
      (priorities 5/10), three DKIM CNAMEs, SPF and DMARC.
      **Cloudflare Email Routing is NOT involved and must NOT be
      enabled** — it would take over MX handling and conflict with
      Hostinger's delivery. Anyone "tidying up" the zone by turning it
      on breaks the mailbox that Phase 5 waited on.
      Original wording follows: support@imageextract.pics exists and
      receives mail — verify before launch. One address, used for abuse,
      privacy, and takedown alike; every shipped page prints it and
      nothing else. It holds Phase 5 open until mail demonstrably
      flows — a bouncing address on a page whose whole defence is good
      citizenship is worse than no address at all.
      **Supersedes the one-inbox-two-names plan (2026-08-12):** abuse@
      and privacy@ as two names aliasing into one mailbox. Dropped
      because the mailbox that actually exists is support@, and one
      address cannot rot half-way — with two names, a silently failing
      alias leaves one page printing a bouncing address while the other
      looks fine.
- [x] Cloudflare Web Analytics auto-injection is OFF — **it was ON, and
      it fired the moment the custom domain was attached (2026-08-12).
      Incident recorded in full because the SEARCH is the reusable
      part.**
      What happened: attaching imageextract.pics put a
      `static.cloudflareinsights.com/beacon.min.js` script (with a
      data-cf-beacon token) into all seven pages — including
      /privacy, which serves "We use no analytics, advertising, or
      tracking services." That sentence was false on the live site for
      roughly an hour.
      **WHERE IT ACTUALLY LIVED — the correction that matters.** The
      setting is at **ACCOUNT level: Analytics & Logs → Web Analytics →
      the site entry for imageextract.pics → automatic injection**. It
      is NOT the zone toggle. The zone's **Speed → Real user monitoring
      page reported RUM as DISABLED the entire time**, because the zone
      toggle and the account-level site entry are separate settings.
      Three dashboard pages actively misled before the right one was
      found. Anyone reading the zone page and concluding "analytics are
      off" repeats the mistake — which is why layer 5's residual note
      in `src/lib/doc-sync.test.ts` now names the exact path instead of
      just saying "check the dashboard".
      **Why nothing in the repo could have caught it.** Source was
      clean and doc-sync layer 5 passed throughout — correctly; this is
      precisely the dashboard-side path layer 5 names as uncoverable.
      It was invisible two independent ways: zone features do not apply
      to `*.workers.dev`, so the identical Worker was clean on one
      hostname and injected on the other (it could ONLY appear at the
      moment the hostname joined the zone); and injection is gated on
      browser-like request headers, so `curl` with default headers
      showed zero script tags while a browser showed one.
      **Verified gone (2026-08-12), three ways:** header-shaped fetch of
      all 7 pages → beacon 0; real-browser DOM → beacon 0 and script
      counts identical to the local build (1/0/0/0/0/2/0, so nothing is
      being added); and the strongest check — **zero requests to any
      non-first-party host across all 7 pages**, which catches injection
      by any mechanism rather than only the script tag we knew to grep
      for. /privacy's sentence is true on the live site again.
      Standing consequence: AGENTS "Releasing" now requires the
      rendered-HTML third-party check after every deploy **and after
      configuration changes**, since Rocket Loader, Email Obfuscation
      and Bot Fight Mode can all appear the same way with no deploy at
      all.
- [x] Workers Paid ($5/mo) — active, confirmed before the first
      deploy. Required: the free tier's 10 ms CPU ceiling would fail
      every scan (measured worst case is 1,570 ms of parse).
- [x] Deploy-on-push — **CLOSED as not-doing (2026-08-12), a decision
      rather than outstanding work.** Releases are a direct
      `npm run build && npx wrangler deploy` after the gates pass. The
      deciding reason: verify:landing and verify:results drive a real
      Chromium, Cloudflare's build environment would not run them, so
      deploy-on-push would ship code that never passed the gates this
      project spent phases building. Full reasoning, the named cost,
      and the middle path (deploy-on-push from a PRODUCTION BRANCH, not
      `main`) in DECISIONS.md "Releases are a direct wrangler deploy,
      not deploy-on-push". Checked, not left blank: an unchecked box
      reads as owed work.
- [x] Billing alert configured — set 2026-08-12, before the first scan
- [x] Vantage re-scan from the deployed Worker — **done 2026-08-12,
      forced early by the first production scan. THE CORPUS HOLDS:
      production coverage is not materially worse, six of seven pages
      match to the image.** astro.build 159/159, wikipedia 84/84,
      apple 318/318, guardian 716/722 (churn), allbirds 99/99,
      gymshark 12/12 — and behance 128 local / **0 production**.
      No coverage claim in STATUS or frontend-plan needs correcting.
      **METHOD, which is the reusable part:** same URL, same minute,
      local Worker vs production Worker, identical code. NOT a
      comparison against the recorded historical numbers — those ran
      three days earlier on collection paths never written down, on
      pages frontend-plan already notes churn per request, so that
      comparison would have produced unexplained deltas with no way to
      separate vantage from churn. Holding everything constant except
      egress makes any difference attributable to one variable.
      **behance.net is a probe, not a regression — it was never in the
      corpus** (first scanned 2026-08-12). Same signature as etsy:
      successful scan, HTTP 200, no robots block, zero images. Recorded
      beside it in frontend-plan.
      **The discriminator stays OPEN, labelled a hypothesis.** Request
      shape and runtime/TLS are eliminated (the local Worker is the same
      workerd binary on the same code and gets 128 — only egress
      differs). But production egressed from MCT (Oman) and the laptop
      from KHI (Pakistan), so ASN class and country are CONFOUNDED.
      Datacentre-ASN reputation is the weighted read, not the finding.
      **The one test that settles it:** a single fetch of behance.net
      from a residential IP in Oman, or from a datacentre IP in
      Pakistan. Cheap enough that it should happen the first time
      anyone has either vantage.
      Still unrun from production: lovehoney.eu, amazon, etsy, unsplash
      — the original walled four. Not blocking; the corpus question
      they existed to answer is now answered by the table above.

## Phase 8 — Post-launch

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
