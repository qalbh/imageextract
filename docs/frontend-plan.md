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

Done when:
- [ ] `width?`/`height?` on `ScanImage`, populated from all five sources
- [ ] Srcset heights derived from the parent img ratio where available
- [ ] `dimensionSource` set 'declared' at scan, flipped 'measured' on load
- [ ] `variantGroup` present on srcset/picture variants, absent elsewhere
- [ ] AGENTS.md manifest snippet updated; "No dimensions" wording amended
- [ ] doc-sync test extended to cover the new manifest lines
- [ ] Extractor tests cover each capture source and the first-wins dedupe rule
- [ ] Coverage measured on 3 real pages and recorded in STATUS.md

## 4. Filters — source groups and type

Sidebar filter over ~5 user-facing source buckets derived from
`IMAGE_SOURCES` with a compile-time exhaustiveness check, plus file-type
filter. Live counts per bucket. Tile badges keep the raw source value.

Decision (2026-08-08): **changing any filter resets the reveal cap** (step
7) — a filtered view starts from the first 120 matching tiles.

Done when:
- [ ] `SOURCE_GROUPS` covers all 14 sources, enforced at compile time
- [ ] Duplicate-membership guarded by a unit test
- [ ] Counts update with the filtered set; empty-filter state designed
- [ ] Raw `source` still visible per tile
- [ ] Filter change resets the reveal window to the cap

## 5. Search and sort

Search across filename/URL/type; sort by dimensions (declared-first data
from step 3) and later by size once probing exists. Unknown values sort
last, stated in the UI.

Decision (2026-08-08): **the sort key is frozen at sort time** — a tile
whose measured dimensions arrive after sorting does not jump position;
re-sorting applies the newest values.

Done when:
- [ ] Search narrows the grid as you type, case-insensitive
- [ ] Dimension sort works without scrolling the page first
- [ ] Tiles do not reorder as measurements trickle in post-sort
- [ ] Items lacking data group at the end with a visible "unknown" cue

## 6. Selection and copy

Selection state per tile, select-all/none over the *filtered* set, sticky
selection bar with count, copy-selected-URLs to clipboard.

Decisions (2026-08-08): **select-all spans the entire filtered set, not
just the revealed tiles** (120 visible, 400 matching → 400 selected), and
**selection survives filter changes** — hidden-by-filter tiles stay
selected and count toward the total.

Done when:
- [ ] Select all covers the filtered set beyond the reveal window
- [ ] Deselect all always global
- [ ] Changing filters neither drops nor duplicates selections
- [ ] Sticky bar shows count and survives scrolling
- [ ] Copied URLs match the manifest values exactly, newline-separated

## 7. Grid scaling

Incremental reveal (initial cap 120 tiles — the design-system constant —
auto-append via IntersectionObserver) plus `content-visibility: auto` on
uniform `aspect-square` tiles, whose fixed ratio makes
`contain-intrinsic-size` exact rather than estimated. Filter changes reset
the reveal window (step 4). Escalation path if a mid-range phone still
janks: `@tanstack/react-virtual` (MIT).

Done when:
- [ ] 1,000-image scan scrolls smoothly on a mid-range Android phone
- [ ] Filter flips on the full set stay under a perceptible stall
- [ ] Selection and badges behave identically across revealed boundaries

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
