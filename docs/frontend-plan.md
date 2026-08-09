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
      the real-device claim retires with the Phase 3 ZIP device pass
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
- [ ] Fallback fires only after a direct-load error, once per tile
- [ ] Zero HEAD requests until the user selects individual images or clicks
      Calculate size (verified by counting network calls on a large page)
- [ ] Em dash remains for unprobed tiles and for un-calculated select-all
      totals

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
