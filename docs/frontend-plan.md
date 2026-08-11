# Frontend build plan — Phase 2

## Pre-launch blockers (from the landing page, 2026-08-08)

**HARD blockers — launch does not happen without these:**
- **Contact mailbox** (`support@imageextract.pics`) live and monitored — the
  landing footer links it, and /traffic, /terms, /about and /privacy all
  print it. A bouncing address is worse than none for a tool whose defence
  is good citizenship. (Was `abuse@`, with `privacy@` planned alongside it
  as a second name over one inbox; superseded 2026-08-12 — support@ is the
  mailbox that exists, and it carries abuse, privacy, and takedown alike.)
- **`/traffic` UA-explainer page — SHIPPED 2026-08-10** (renamed from the
  planned `/bot`: "bot" mischaracterised a user-directed fetch; nothing was
  deployed, so the rename cost one string). Hard dependency of the
  User-Agent string, which now carries the new path. Linked from the
  footer (Company); the UA string is its primary route in.

General pre-launch (linked from the landing footer, 404 until Phase 5/6):
`/privacy` · `/terms` · `/about`.

## Copyright notice placement (moved 2026-08-09)

The "Images belong to their creators…" notice was removed from the landing
hero and now lives **only on `/results`, above the results grid** — where
downloads actually happen. This placement is required by the definition of
done (copyright notice above the results grid) and is better regardless: the
hero is not where anyone downloads. Confirmed rendering at `results.astro`.

## Landing demo grid (built 2026-08-09)

`src/components/DemoGrid.astro` fills the reserved `--layout-demo` band on
`/`, driven by `src/fixtures/demo-scan.ts` (a real `ScanResult` + companion
`demoTileMeta` for the not-yet-on-`ScanImage` dimensions). Masonry is used
here **and only here**; `/results` stays uniform `aspect-square`. Vanilla
inline script (2.1 KB gz, well under the 8 KB budget the gate now enforces),
no island. Scripted intro on 40%-visible + idle, once; any input hands off
to full interactivity; `prefers-reduced-motion` renders the end state
(JPEG filter + selection) interactively; the same markup is the no-JS
fallback. 14 demo images are 400px webp (116.3 KB total); source PNGs are
gitignored to hold the DECISIONS.md ~120 KB demo-asset budget.

Build sequence for the results UI. Each step is a reviewable unit; the
recommendations from the 2026-08-08 repo review (declared dimensions,
`/results` route split, grouped source filter, incremental reveal +
`content-visibility`) are accepted and folded in, as are the decisions
recorded 2026-08-08: **tiles on `/results` are uniform `aspect-square`;
masonry appears only in the landing-page demo grid.** ZIP and downloads
are Phase 3 and deliberately absent.

## 1. Design tokens and restyle

Tokens are DONE — `@theme` in `src/styles/global.css` (palette incl. the
muted-ochre warning triple, type scale with `text-label`, 6-step spacing,
radius pinned to 4px) with rules in `docs/design-system.md`. Remaining:
restyle `index.astro`, `ImageCard`, `ResultsGrid` against the tokens, then
retire Tailwind's default spacing scale. Logic untouched. Tiles stay
uniform `aspect-square`.

Done when:
- [x] `@theme` in `global.css` defines the palette, radius, and type scale
- [ ] No `text-[11px]`-style arbitrary values left in components
- [ ] Components reference token-backed utilities only
- [ ] Tailwind default spacing scale disabled after migration
- [ ] Zero-JS budget unchanged (island hydration scripts only)

## 2. Route split — static `/`, island on `/results`

`/` becomes fully static marketing with the form posting to `/results`
(`action="/results"`, native GET). `/results` (prerendered shell) carries
the form, copyright notice, and the only React island, plus three head
tags: `noindex, nofollow`, `referrer: no-referrer` (thumbnail privacy),
and a query-less canonical (`https://imageextract.pics/results`) because
the `?url=` space is unbounded.

**Phase 6 obligation recorded here so it isn't lost:** our `robots.txt`
must carry `Disallow: /results` — the meta robots tag only works if the
crawler fetches the page at all.

Done when:
- [x] `dist/client/index.html` contains zero `<script>` tags
- [x] `/results?url=…` scans and renders; empty `/results` prompts for a URL
- [x] `noindex, nofollow` + `no-referrer` + canonical on `/results` only
- [x] Shared `ScanForm.astro` used by both pages (one `id="scan-url"` per page)

## 3. Declared dimensions in the manifest

Capture `<img width/height>`, srcset `w` descriptors, `og:image:width/height`,
`link[sizes]`, and JSON-LD `ImageObject` width/height during the existing
HTMLRewriter pass. `ScanImage` gains optional `width`/`height`. Zero extra
subrequests. Tiles seed from declared values and correct on load.

Decisions (2026-08-08):
- A srcset candidate's **height is derived from the parent `<img>`'s aspect
  ratio** (its `w` descriptor gives width only).
- `ScanImage` carries **`dimensionSource: 'declared' | 'measured'`** so the
  UI can distinguish page claims from load-time truth.
- A **`variantGroup` id is captured at extraction time** for candidates
  that are size variants of one image (same srcset/picture); the UI for
  grouping is deferred.

Shipped 2026-08-09. `variantGroup` semantics were pinned to **one per
logical image**: a whole `<picture>` (all its `<source>`s + the fallback
`<img>`) is one group, and a standalone `<img>`'s src+srcset is one group —
not one per srcset attribute. `<source>` candidates are width-only by design
(the sibling `<img>`'s aspect ratio isn't available in a streaming pass;
that's where coverage is thinnest — see below).

Done:
- [x] `width?`/`height?`/`dimensionSource?`/`variantGroup?` on `ScanImage`
- [x] Srcset heights derived from the parent img ratio where available
- [x] `dimensionSource` set 'declared' at scan (UI flips to 'measured' on load — deferred)
- [x] `variantGroup` per logical image; absent on standalone single images
- [x] AGENTS.md manifest snippet + "No dimensions" wording amended
- [x] doc-sync extended to check the `dimensionSource` line vs `DIMENSION_SOURCES`
- [x] Extractor tests cover each source, derivation, variantGroup, first-wins
- [x] Coverage measured on real pages (recorded here, not STATUS.md)

### Coverage (6 live pages, 553 manifest entries, 2026-08-09)

Pages: wikipedia.org, web.dev, developer.mozilla.org, smashingmagazine.com,
en.wikipedia.org/wiki/Photography, astro.build.

**Aggregate: 35% have ≥ a width, 19% have both dimensions.** The aggregate is
misleading — the split is what matters for the size-tier filter:

| Source | n | ≥ width | both |
|---|---|---|---|
| img | 117 | 86% | **85%** |
| srcset | 122 | 72% | **0%** |
| picture | 17 | 0% | 0% |
| inline-svg | 123 | 0% | 0% |
| stylesheet | 117 | 0% | 0% |
| style-block | 36 | 0% | 0% |
| favicon | 13 | 8% | 8% |
| meta | 7 | 43% | 43% |
| json-ld | 1 | 0% | 0% |

**Implication for the sidebar's size-tier filter:** it is fully viable for
`img`-sourced images (85% have both dimensions — the images users usually
want) and for `meta`. It is **width-only for `srcset`** (72% width, ~0%
height: real responsive imgs carry a `w` descriptor but size via CSS, so the
parent rarely declares `height`, so the aspect-derivation almost never fires —
the mechanism is correct, the source data isn't there). It is **effectively
blind for CSS backgrounds, inline SVG, and `<picture>` `<source>`s** (~0%).
So: a size-tier filter must treat "unknown" as a first-class, prominent tier,
and sorting by height/aspect only meaningfully orders the `img` subset. Width
sort covers `img` + `srcset` (~43% of entries here).

### Static-parse coverage vs browser ground truth (7 live pages, 2026-08-10)

The Phase 8 question ("measure real static-parse coverage") pulled forward
and answered. **Method:** ground truth per page = headless Chromium
(1440×900, DPR 1) loads the page, scrolls to the bottom to fire lazy
loaders, then unions every main-frame network image response, every DOM
`img.currentSrc`, and every computed `background-image` URL — minus
tracking beacons (18 explicit host/path patterns), sub-3px pixels, and
iframe/ad loads. Scan side = the real `/api/scan`. Both normalized
identically to `resolveCandidate` (fragment stripped, params sorted).
Matching: exact URL → **variant** (same origin+path, different sizing
params) → miss; every miss searched in the HTML *the scanner's UA was
served*, span-aware: `<noscript>`, `<script>` state JSON, plain markup,
fetched stylesheet, or absent.

| Page | Category | Truth | Exact | Logical | Misses were |
|---|---|---|---|---|---|
| allbirds /collections | ecommerce-SSR | 54 | 87.0% | 90.7% | ~5 script-JSON / page churn |
| gymshark /collections | ecommerce-SPA | 158 | 39.9% | 45.6% → **98.1%** | 78 cap-trimmed + 7 noscript (both fixed) |
| unsplash /t/wallpapers | js-gallery | — | — | — | Anubis bot wall (served `…/anubis/…/reject.webp`) |
| theguardian /international | news | 105 | 1.0% | **100%** | — |
| apple.com | marketing | 42 | 50.0% | 50% → **100%** | 21 of 42 only in `<noscript>` (fixed) |
| en.wikipedia /Photography | anchor | 62 | 16.1% | 72.6% | 17 skin icons via stylesheet chain |
| astro.build | anchor | 42 | 14.3% | **100%** | — |

Probes: amazon robots-allows the scan but runs a per-request lottery (0,
some, 117 images across three identical scans); etsy serves a challenge
page (successful scan, zero images). Exact-vs-logical is its own
DECISIONS.md entry; the deep-scan closure ("bot walls, not JavaScript")
is another.

lovehoney.eu (probed 2026-08-10, post-fixes): **geo/IP edge block, a
wall sub-class the corpus rows don't show.** Akamai serves a static 403
"Blocked request / technical difficulties" page (unchanged since 2022,
reference-numbered) whose only `<img>` is the logo. Identical body to
the bot UA, a stock-browser UA, AND real Chrome from the same network,
so it keys on IP geography, not UA or TLS — unlike Anubis, real users
here are blocked too. Not a consent interstitial: no redirect, no
consent vendor, hard 403.

**The scanner was correct throughout.** It extracted 100% of the page
it was served — the block page holds one image and the manifest says
one image, before the noscript/logical-cap fixes and after (they are
irrelevant to a one-image page). "Returns 1 image on a major ecommerce
site" will read like a parsing bug in every future skim of this
document; it was not one, at any point.

**This class is a limit on the corpus, not just a caveat on this
site.** The entire coverage study ran from one network location, and
lovehoney proves at least one failure mode is vantage-dependent:
amazon/etsy/unsplash key on bot-ness, which travels with the scanner —
this keys on IP geography, which does not. "Readable vs walled" is
therefore not fully measurable from a laptop, and every classification
in the table above carries that asterisk. The only way to answer this
class is to re-run the walled probes from the deployed Worker's own
egress (Phase 7 item in STATUS.md); if Cloudflare's vantage lands them
readable, the corpus materially changes and gets re-recorded.

**Open question — the consent-interstitial class (no specimen yet, do
not go hunting).** A GDPR/geo consent redirect serving a near-empty
interstitial would be a fourth page class, distinct from walls because
it might be addressable — and .eu commerce is a large surface. But it
is currently a hypothesis with zero specimens: lovehoney was suspected
of being one and turned out to be a wall. Deferred-decision discipline
applies: if a real consent-redirect specimen turns up in live scans,
measure it then; no investigation opens on no evidence.

**Post-fix recount (measured, not projected).** After noscript parsing
and the logical-image cap landed: gymshark = 2,731 entries, **204 logical
units, no truncation** (the page that exhausted the candidate cap at ~125
products now fits with ~800 units of headroom); **83 of its 86
previously-lost images land** (1 was a beacon, 2 rotated away between
sweeps); apple = all 21 noscript-only images land, 42/42. Manifest
transfer at the new entry ceiling: gymshark's 2,731-entry JSON is 899 KB
raw, **67 KB gzipped** (13:1 — URL prefixes repeat); extrapolated to the
`MAX_RAW_CANDIDATES` ceiling of 5,000 ≈ 1.6 MB raw / ~125 KB wire. This
is a **transfer-size question only, not a rendering one** — the 120-tile
reveal cap mounts the same DOM regardless of manifest length. Verdict:
acceptable on a phone connection; the ceiling stands unchanged.

**What contaminates this measurement** (anyone re-running it inherits
these): (1) **beacon inflation** — tracking pixels served as images
(google `/pagead/`, reddit `rp.gif`, `securemetrics.*`…) land in the
network truth but never in the DOM-size filter; first-run allbirds read
60.3%, which would have argued for the rethink the clean data does not
support. (2) **weak-needle misclassification** — a bare pathname like
`/w/load.php` matches unrelated references; wiki's stylesheet icons
first classified as parser misses. (3) **cap-truncation masquerading as
parser gaps** — gymshark's 78 "in-html" misses were candidates the parser
had read and the cap had trimmed; distinguishing needs the raw-HTML URL
count (2,998) against the manifest, not the miss list alone. Standing
caveats: one viewport/DPR, per-request HTML variance (allbirds carousels,
the amazon lottery), and inline-SVG counts are incomparable (manifest
dedupes identical serializations; the DOM counts instances).

## 4. Filters — source groups and type

Sidebar filter over ~5 user-facing source buckets derived from
`IMAGE_SOURCES` with a compile-time exhaustiveness check, plus file-type
filter. Live counts per bucket. Tile badges keep the raw source value.

Decision (2026-08-08): **changing any filter resets the reveal cap** (step
7) — a filtered view starts from the first 120 matching tiles.

Done when:
- [x] `SOURCE_GROUPS` covers all 14 sources, enforced at compile time
- [x] Duplicate-membership guarded by a unit test
- [x] Counts update with the filtered set; empty-filter state designed
- [x] Raw `source` still visible per tile
- [x] Filter change resets the reveal window to the cap

**Revised by coverage data (2026-08-09) — the mockup's size UI does not
survive the real numbers (step 3: 19% both-dimensions, 35% width; img 85%
both, srcset width-only, CSS/SVG/picture ~0%):**
- **Drop the four-tier size filter** (Large / Medium / Small / Icons). With
  19% both-dimension coverage, ~81% of images land in "unknown" — that is
  not a filter, it is a control that looks broken. Cut it from the sidebar.

**Shipped 2026-08-09** (`src/lib/results-model.ts`, `ResultsSidebar.tsx`):
`SOURCE_GROUPS` maps all 14 sources into 5 buckets (Page images · CSS
backgrounds · Inline SVG · Meta & icons · Media & embeds), with a
compile-time `Exclude<…> extends never` exhaustiveness check and a
runtime "exactly one bucket" test. Filter composition is **OR within a
group, AND across groups**. Counts are **faceted** — each group's counts
honour the *other* groups' active filters; the Format "All" row shows the
faceted total. **Zero-count rows render disabled and muted, never removed**
(no reflow under the pointer). The source group is a `<details>`, collapsed
by default. A **filename/URL search** input was added at the top of the
sidebar (an unchecked Phase-2 item, and the fastest way to find one image
among hundreds); it matches filename and URL, folded into `applyFilters`.
The four-tier size filter is omitted as decided.

## 5. Search and sort

Search across filename/URL/type. Sort by dimensions is constrained by the
step-3 coverage data (2026-08-09):
- **Sort by width is viable and kept** — `img` + `srcset` is ~55% of a
  typical manifest. Unknowns sort last, with an honest count in the UI
  ("sorted by width · 302 of 553 known").
- **Sort by height or aspect ratio orders only the `img` subset (85%)** and
  silently mis-ranks srcset/CSS/SVG/picture (they lack height). Either drop
  these sorts or scope them explicitly to measured entries — do not offer a
  height sort that quietly lies about 45% of the grid.
- **Declared values render muted; measured values render full weight.** On
  load, `naturalWidth`/`naturalHeight` upgrade a tile's `dimensionSource`
  to 'measured' client-side, and its dimensions to the true values.

Decision (2026-08-08): **the sort key is frozen at sort time** — a tile
whose measured dimensions arrive after sorting does not jump position;
re-sorting applies the newest values.

Done when:
- [x] Search narrows the grid as you type, case-insensitive — shipped, then
      the CONTROL was removed in the 2026-08-10 design pass (capability and
      tests remain in the model; see the Figma-alignment note below)
- [x] Width sort works without scrolling; unknowns last with a known-count
- [x] Height/aspect sorts are dropped or scoped to measured entries only
- [x] Declared dimensions render muted; measured render full weight
- [x] Tiles do not reorder as measurements trickle in post-sort

**Shipped 2026-08-09** (`results-model.ts` `sortImages`, `ResultsGrid.tsx`):
exactly four sorts — **Document order** (default) · **Width** · **Name** ·
**Type**. Height/aspect sorts are dropped. Width orders `img` + `srcset`
with **unknowns last** and a known-count sub-label ("N of M") in the
sidebar, plus a muted "Unknown sizes sorted last" line. The sort key is
**frozen at sort time**: the sorted memo deliberately omits `measured` from
its deps, so load-time measurements refresh badges but don't reorder tiles
under the pointer; re-picking a sort (or changing a filter) recomputes with
the newest widths. Declared dimensions render `text-muted`; measured flip to
full-weight `text-text` on load.

## 6. Selection and copy

Selection state per tile, select-all/none over the *filtered* set, sticky
selection bar with count, copy-selected-URLs to clipboard.

Decisions (2026-08-08): **select-all spans the entire filtered set, not
just the revealed tiles** (120 visible, 400 matching → 400 selected), and
**selection survives filter changes** — hidden-by-filter tiles stay
selected and count toward the total.

Done when:
- [x] Select all covers the filtered set beyond the reveal window
- [x] Deselect all always global
- [x] Changing filters neither drops nor duplicates selections
- [x] Sticky bar shows count and survives scrolling
- [x] Copied URLs match the manifest values exactly, newline-separated

**Shipped 2026-08-09** (`results-model.ts`, `SelectionBar.tsx`): selection is
a global `Set<id>` — **select-all/invert operate on the whole filtered set**
(labelled "Select all (N)"), **clear is global**, and **selection survives
filter changes** because ids hidden by a filter are never pruned. Copy URLs
writes the selected images' URLs in document order, newline-separated. The
sticky bar reads "N images found" at zero (Download disabled) and switches to
count + actions with a selection.
- **Deferred to Phase 8:** the byte-size total stays an **em dash** — no HEAD
  probing this pass.
- **Deferred to Phase 3:** **Download ZIP is fully disabled** (not
  enabled-but-no-op); the per-tile download icon is likewise rendered disabled,
  for consistency.
- **Invert-background was built now, not deferred:** the Phase-9 deferral
  predated tiles being `--color-surface`, which makes a white-on-transparent
  logo invisible — correctness, not polish. It reuses the landing demo's
  ground swap (`--color-text`). **List view stays deferred**; the
  preview-blocked tile keeps text-only "preview unavailable" (no bespoke icon)
  until the Phase-8 proxy fallback lands; the 4/6-col density toggle is omitted
  (auto-fill already reflows, and a second tile-min has no token).

## 7. Grid scaling

Incremental reveal (initial cap 120 tiles — `TILE_REVEAL_CAP` —
auto-append via IntersectionObserver) plus `content-visibility: auto` on
uniform tiles (262:180 wells since the fidelity pass; the shared shape keeps
`contain-intrinsic-size` near-exact). Filter changes reset the reveal window
(step 4). Escalation path if a mid-range phone still janks:
`@tanstack/react-virtual` (MIT).

Done when:
- [ ] 1,000-image scan scrolls smoothly on a mid-range Android phone —
      REOPENED (2026-08-10 phase-boundary read): what was actually verified
      is 220 tiles at 4× CPU throttle in desktop Chrome (verify:results);
      the real-device claim retires with the POST-DEPLOY ZIP device pass
      (deferred 2026-08-10 — Phase 7 list; this box stays unchecked)
- [x] Filter flips on the full set stay under a perceptible stall
- [x] Selection and badges behave identically across revealed boundaries

**Shipped 2026-08-09** (`ResultsGrid.tsx`, `.result-tile` in `global.css`):
initial reveal cap `TILE_REVEAL_CAP` = 120, an `IntersectionObserver`
sentinel (400px `rootMargin`) appends another 120 on scroll, and
`content-visibility: auto` + `contain-intrinsic-size: auto
var(--layout-tile-min)` skips off-screen tile rendering. Applying a filter
resets the reveal window to the first cap of the filtered set. Verified by
`scripts/verify-results.mjs` (`npm run verify:results`) — a 220-tile fixture
under a 4× CPU throttle: only the cap is mounted at rest, scrolling reveals
the rest. The `@tanstack/react-virtual` escalation path remains available if
a real device still janks; not needed by the probe.

## 8. Proxy fallback and lazy byte-size probing

Hotlink-403 thumbnails retry once through `/api/proxy` (that tile only).
Byte-size badges populate via proxy `HEAD` — never upfront, and the trigger
was re-decided (2026-08-10) after the size sort was cut by the coverage
data: **selecting images individually probes those images** through a
capped, abortable queue; **select-all probes nothing** — the selection-bar
total renders an em dash with an explicit "Calculate size" action beside
it, because a 500-image select-all would otherwise be a 500-HEAD burst
from one click, and a concurrency cap only spreads a burst out rather than
preventing it. No other probing affordance; selection is the affordance.

Done when:
- [x] Fallback fires only after a direct-load error, once per tile —
      verified (2026-08-10, verify:results fallback scenario): 8 tiles with
      failing direct loads → exactly 1 proxy request per tile ([1,1,1,1,1,1,1,1]);
      4 recovered via proxy, 4 dead showing "preview unavailable"; a PNG→All
      filter round trip (which unmounts and remounts the dead tiles) added
      ZERO proxy and ZERO origin requests. Live check closed 2026-08-10 —
      verified live: the referrerless-403 class is real and current across
      three origins (i.pximg.net 403, wx1.sinaimg.cn 403 vs 404-with-referer,
      doubanio 418 block), and our proxy SHARES the failure for this class
      because it is also referrerless (kept so deliberately — see the
      DECISIONS entry: sending a Referer would be browser-context
      impersonation). NOT verified: a full in-app scan→tile→fallback loop
      against a real protected origin, because image-protecting sites also
      page-protect (pixiv unreachable, douban bot-walls page fetches, weibo
      robots-disallows * — our scanner correctly refuses it). That pattern is
      itself a finding: the scan-side encounter rate for this class is
      probably low. The fallback's real recovery classes are CORP/ORB blocks
      and geo/IP splits; referer-required origins land as honest dead tiles.
- [x] Zero HEAD requests until the user selects individual images or clicks
      Calculate size — verified (2026-08-10, verify:results probing scenario,
      HEADs counted server-side): 0 on load/render; 1 per single selection;
      0 on deselect+reselect (cache); 5 for a 5-tile shift-range; 0 for a
      30-tile range (> PROBE_AUTO_LIMIT 24 — falls to "Calculate size (24)");
      0 on select-all
- [x] Totals stay honest — verified: after Calculate size, the bar read
      "30 selected · 44.8 MB + 2 unknown" (one no-Content-Length origin, one
      502), never a silent undercount; peak queue concurrency measured at
      exactly 6; Cancel froze a slow burst at 6 of 8 HEADs with zero arrivals
      after, and the Calculate action returned

**ZIP assembly shipped 2026-08-10** (`src/lib/zip.ts`, client-zip MIT 2.5.0):
members prefetch through the shared queue with slots held until WRITTEN
(byte budget covers blob residency); constants MAX_ZIP_IMAGES 500 (was
250 — moved with the allowance when it settled at 1,000/hr; rate-budget
coherence — half the hourly proxy allowance so a retry plus preceding
probes fit), MAX_ZIP_BYTES_IN_FLIGHT 64 MB (working in the
constant comment; ASSUMES disk-backed Blob storage — the device pass tests
exactly that), ZIP_UNKNOWN_WEIGHT 16 MB corrected on headers. Over-cap is
blocked with the stated bar line, never truncated. Failures: live counts +
"ZIP saved · N of M (k skipped)" + SKIPPED.txt inside the archive. Cancel
is labelled "Cancel (discards ZIP)" — consequence before the click; Blob
path never starts the download, FS-Access abort discards (OPFS-verified:
fresh file 0 bytes, prior contents untouched). Numeric-prefix filenames
deferred (polish).

**Device pass, partial result (2026-08-10, desktop only):** a 120-member
ZIP on desktop completed, saved to Downloads, opened, no tab crash — but
NO PICKER appeared, which by the branch logic means
`'showSaveFilePicker' in window` was FALSE in that browser and the BLOB
path ran (a rejecting picker produces no file at all; a resolving one
shows an OS dialog). TWO causes fit that binary: the browser ships
without the File System Access API (Brave disables it; flags/policy can
too) — or, learned in A2 below, the ORIGIN is not a secure context. The
completion line now names its path ("ZIP saved · … · via picker/browser")
so no future run is ambiguous.

**A2 CLOSED (2026-08-10), and it surfaced the secure-context boundary.**
Run 2, stock Chrome with a human: the real picker appeared, and **cancel
mid-write left nothing at the chosen location** — the FS-Access abort
contract is now WITNESSED through the real picker, not just
OPFS-inferred. Run 1, same browser minutes earlier, seemed to contradict
it: the ZIP arrived silently in Downloads with no dialog. Diagnosed and
reproduced (one Chrome instance, both origins): **the picker path is
secure-context gated** — `showSaveFilePicker` exists on localhost and
https and does NOT exist on a plain-http LAN address
(`http://192.168.x.x:4321` → `isSecureContext: false`, API absent), so
Run 1 was the Blob path working correctly in a context that has no
picker, completion line "· via browser". Activation expiry was ruled out
twice: EMPIRICALLY (instrumented picker called 0.2–0.6 ms after the
click with `userActivation.isActive: true` at both 2 selected and
select-all-159 — nothing before the picker scales with selection; it is
the handler's first await) and STRUCTURALLY (any picker rejection —
dismissal or SecurityError alike — returns without downloading anything,
so a file in Downloads can only mean the branch was never entered).

**Consequence, stated so nobody reads it as a gap: any device run
against the LAN IP exercises the Blob path BY CONSTRUCTION** — and for
the Android pass that is the right test for the right reason: a phone
must use the LAN IP, Android has no FS-Access picker anyway so the Blob
path is what a phone uses in production, and the disk-backed-Blob
assumption under test is a Blob-path property. In deployed production
(https everywhere) the secure-context split disappears. The mid-range
ANDROID box below is NOT retired — desktop memory says nothing about the
phone, where the disk-backed-Blob assumption is load-bearing.

**Device pass — DEFERRED TO POST-DEPLOY (2026-08-10, Phase 7 list; the
step-7 box below stays unchecked until it runs).** Deferred because it
needs a LAN setup now, and after deploy it runs against the real https
URL from any phone anywhere — cheaper and more representative. The risk
carried in the interim: the disk-backed-Blob assumption behind
MAX_ZIP_BYTES_IN_FLIGHT stays unverified, so a large mobile ZIP could
OOM the tab; the failure mode is a lost download and a reload, not data
loss or a security issue. The script below is unchanged and runs as
written against the deployed URL (the LAN instructions become moot):
run on a mid-range Android — pre-deploy fallback:
`npx astro dev --host` on the Mac, open
`http://<mac-ip>:4321/results?url=<large page>` on the phone. (1) Scroll
the full grid first — jank here is the step-7 signal. (2) Select all
(300+ if the page allows), Download ZIP; watch for tab reload/crash during
assembly (the OOM symptom — this is the disk-backed-Blob assumption under
test), progress advancing while the page stays scrollable. (3) Completed
ZIP in Downloads: opens, member count = N − skipped. (4) Second run,
Cancel midway: NO partial file in Downloads, UI back to idle. (5) Desktop
Chromium once: the save-picker flow end-to-end (choose location, cancel
one mid-write, confirm no partial file).

**Dimension probing shipped 2026-08-10** (`image-dimensions.ts` parsers +
the unified `probeMeta`; proxy gained Range forwarding, Content-Range
exposure, and true 206 passthrough — fixing the pre-existing 200-over-206
mislabelling): ONE prefix Range (4 KB uniform) answers dimensions AND byte
size, so the client's HEAD probe retired (server variant stays). Sorts are
one row per key (Document/Image size/Width/Height/Name/Type) + a direction
text-toggle for the metric sorts; unknowns-last regardless of direction.
"Measure dimensions (N)" is the explicit bulk action (sort clicks cost 0
probes — gate-asserted), with the hourly-allowance note past
MEASURE_WARN_AT (200); a settled Measure batch triggers ONE re-sort —
outside the frozen-sort rule's scope (that rule stops TRICKLE reordering
nobody asked for; an explicit batch asks for exactly this ordering), not
an exception to it. Probed dims land in the existing measured map: chips
flip to measured weight, "n of m" counts update, naturalWidth-on-scroll
keeps shrinking the Measure count free. Gate: dims arrived free with size
probes (29/30 chips measured, no Measure button needed afterwards); a
range-ignoring 30 MB origin was stopped at 16,384 bytes sent
(server-counted).

**Probing shipped 2026-08-10** (`fetch-queue.ts` — the bounded queue step 4
reuses (count cap + bytes-in-flight budget with an always-admit-one rule);
`probeSize`/`dataUriBytes`/`formatBytes`/`sizeSummary` in `results-model.ts`):
sizes cache per scan beside the fallbacks map; deselection cancels in-flight
probes by key, but a probe that resolved before its cancel still caches —
the subrequest is spent and sizes are immutable. Three terminal states
(bytes / unknown-length / failed, timeout included — client timeout 10s so
six hung HEADs can't freeze the queue for the server's 30s). data: URIs
compute locally, exact decoded bytes, zero network. formatBytes is decimal
(KB=1000) so the number matches the user's downloads folder.

**Fallback shipped 2026-08-10** (`canProxyFallback`/`proxyUrl` in
`results-model.ts`; the monotonic `fallbacks` map in `ResultsGrid.tsx`):
retry-once is enforced by parent-owned state, not component state, because
tiles unmount on filter changes (measured: a filter round trip re-requests
remounted images — sort/selection/invert do not). Only http(s) URLs retry;
data: URIs (inline-svg) go straight to dead — the proxy would reject the
scheme. Dead tiles mount no img at all, which also stopped the pre-existing
origin re-request on every filter flip. Mid-retry the tile shows the neutral
well ground; the fallback img is eager (it is by definition already in the
viewport). The remount cost of RECOVERED tiles is absorbed by the proxy's
cache-control: private, max-age=3600 — now marked load-bearing in proxy.ts.

## 9. Mobile pass and polish

Mobile layout, invert-background toggle (for white-on-transparent images),
keyboard/focus audit.

Done when:
- [x] Grid, filters, and selection usable one-handed at 390 px wide
- [x] Invert toggle flips tile backgrounds without reloading images
- [ ] Focus order and visible focus states through form → filters → grid —
      REOPENED (2026-08-10 phase-boundary read): whole-tile keyboard
      selection and the focus ring are verified, but the full ordered
      walk-through was never run; the earlier check overclaimed

**Shipped 2026-08-09 — two 390px frames.** Landing (`index.astro`) was already
mobile-first (1-col capabilities/FAQ, `grid-cols-2` footer, `column-count: 2`
demo); the pass removed the connecting hairlines from the stacked steps on
mobile and scaled the H1 `text-h1 → md:text-display` (both existing tokens; 88px
can't wrap at 390px). Results (`ResultsGrid.tsx`): the 260px sidebar becomes a
**bottom sheet** (`.filter-sheet`) opened by a Filters trigger in the sticky
bottom chrome; the grid drops to `.results-grid` 2-up; a `--color-overlay` scrim
dims the content while the selection bar stays visible above the sheet. One new
token — `--color-overlay` (`rgb(17 17 17 / 0.5)`, derived from `--color-text`) —
was added for the scrim; 70vh and the responsive breakpoints/column-counts are
structural (in `global.css` classes), not tokens. Invert-background shipped
earlier with step 6.

**Mobile-pass review fixes (2026-08-09):**
- **Shared `SiteHeader`** on / and /results (wordmark + nav, hairline). Below
  `sm` the nav is hidden (wordmark-only) — it can't sit beside the wordmark at
  390px. /results gets a compact `ScanForm` variant: a SOURCE row (label, URL
  chip with a clear ×, Re-scan link); the hero input stays on /.
- **Whole-tile selection**: the tile is `role="button"` (pointer + Enter/Space),
  shift-click ranges over the filtered+sorted order (`selectRange`, tested), the
  disabled download button stops propagation, and the checkbox is a visual cue.
- **Selected frame** switched from an inset `outline` to a 2px accent **border**:
  `content-visibility: auto`'s paint containment renders an inset outline
  unevenly (thin top / doubled bottom). Focus is an outset outline with
  containment lifted on `:focus-visible`.
- **Tile redesign**: dimension chip top-right (dark=measured, muted=declared,
  **absent** when unknown until load), source badge removed (source is a sidebar
  filter), footer = filename + format label + disabled download square.
- **Invert** is now a **switch** (`role="switch"`), not a checkbox — the rule
  "checkboxes/radios filter, switches set display modes" is in design-system.md.
- **Format filter** shows the full supported set always; zero-count rows render
  disabled+muted, never removed. `unknown` reads UNKNOWN (was mislabelled OTHER).
- **Mobile selection bar** is two rows (actions; then Filters + count + Download);
  desktop stays one row.

**Design-fidelity pass (2026-08-09):** the tile well went square → **262:180
with `object-cover`** (squares letterboxed everything; measured 48px empty
bands on 16:9), with an **icon carve-out** — `ICON_SOURCES` (favicon,
inline-svg) stay contain-at-natural-size because cover upscales a 32px raster
to mush. Page ground moved to `--color-bg` (body rule in global.css; tiles
were surface-on-white and their borders invisible). Checkbox 20×20 with a
`--color-muted` border (held its edge on white images). Filename became sans
`text-caption` `font-medium` — the 400–700 variable axis genuinely includes
500 — freeing ~2× the characters vs tracked 11px mono, helped by the download
button shrinking 40→28px. Dimension badge: `--color-overlay-strong` (0.7, new
token) for measured / solid `--color-muted` for declared — 0.5 alpha measured
only ~3.5:1 over a white image, so the muting moved into the chip colour
difference instead of alpha. Format tag = solid `--color-bg` chip. Toggle
track solid `--color-border` off (surface track read as a bare knob); pill
declared canonical over the demo's chip. Source bar chip content-sized via
`field-sizing: content`, 28ch ellipsized fallback. Copyright line regained
"Nothing is stored or logged." Spacing: all design values mapped onto the
scale (10/12→8, chip verticals→0); no new step needed.

**Figma-alignment pass (2026-08-10):**
- **FIND control removed** from the sidebar per design. The capability stays
  in `results-model.ts` (`query` in `FilterState`, `matchesQuery` tested);
  the island passes `''`. Reinstating it is one input. STATUS.md item
  unchecked accordingly.
- **List view: DEFERRED, not cancelled** — the design exists (Grid/List
  toggle in the frame); we are holding the feature. DISPLAY holds only
  Invert background until it lands.
- **Radius policy replaced**: "4px only" → the named set sm 2 / md 4
  (default) / full, with the `--radius-*` namespace wiped and stray aliases
  rejected by verify-landing. Audit before the change: all 27 radius sites
  used the `sm` alias incidentally (it rendered 4px); all were rewritten to
  `md` except the download square (genuine sm 2px) and the toggle (full).
- **Copyright notice reversed to the alert treatment** (accent on
  `--color-notice-bg`, info icon, dismiss ×) — reversing the earlier
  permanent-muted-line decision — and moved into the island so the
  definition-of-done condition is enforceable: **dismissal is component
  state, never storage; the notice reappears on every scan.** With JS off
  the island doesn't render, so there is no grid and no download path —
  nothing for the notice to caveat.
- **Sidebar typography**: mono confined to section headings; option rows
  sans `text-small`. Toggle rebuilt to the design (32×18 / 14px knob /
  `--radius-full`, 44×44 hit area via `::before`). Sidebar on surface with
  section dividers; grid area on bg; "Showing X of Y" right-aligned;
  unselected tiles carry a visible 2px border-colour frame (same thickness
  as the selected accent frame — no layout shift); the dimension chip pairs
  the checkbox (20px / `--radius-md` / same inset).
