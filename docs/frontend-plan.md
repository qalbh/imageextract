# Frontend build plan — Phase 2

## Pre-launch blockers (from the landing page, 2026-08-08)

**HARD blockers — launch does not happen without these:**
- **Abuse mailbox** (`abuse@imageextract.pics`) live and monitored — the
  landing footer links it. A bouncing abuse address is worse than none for
  a tool whose defence is good citizenship.
- **`/bot` crawler-info page** — hard dependency of the User-Agent string;
  must exist before the first real scan. Deliberately NOT linked anywhere
  until it exists: site owners follow that URL from their access logs.

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
- [x] Search narrows the grid as you type, case-insensitive
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

Incremental reveal (initial cap 120 tiles — the design-system constant —
auto-append via IntersectionObserver) plus `content-visibility: auto` on
uniform `aspect-square` tiles, whose fixed ratio makes
`contain-intrinsic-size` exact rather than estimated. Filter changes reset
the reveal window (step 4). Escalation path if a mid-range phone still
janks: `@tanstack/react-virtual` (MIT).

Done when:
- [x] 1,000-image scan scrolls smoothly on a mid-range Android phone
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
Byte-size badges populate via proxy `HEAD` — only on selection or
size-sort, never upfront.

Done when:
- [ ] Fallback fires only after a direct-load error, once per tile
- [ ] Zero HEAD requests until the user selects or sorts by size
      (verified by counting network calls on a large page)
- [ ] Em dash remains for unprobed tiles

## 9. Mobile pass and polish

Mobile layout, invert-background toggle (for white-on-transparent images),
keyboard/focus audit.

Done when:
- [ ] Grid, filters, and selection usable one-handed at 390 px wide
- [ ] Invert toggle flips tile backgrounds without reloading images
- [ ] Focus order and visible focus states through form → filters → grid
