# Design system

`src/styles/global.css` is the sole source of color, type, spacing, and
radius values. If a value you need is not there, raise it before adding it.

## Color

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#FAFAF8` | page background |
| `--color-surface` | `#FFFFFF` | cards, inputs, raised surfaces |
| `--color-text` | `#111111` | primary text |
| `--color-muted` | `#6B6B6B` | secondary text, captions |
| `--color-border` | `#E4E4E0` | all borders |
| `--color-accent` | `#1B4DFF` | see accent rules below |
| `--color-light-muted` | `#9B9B9B` | **decoration only** — see warning below |
| `--color-warning-bg` | `#FAF3E3` | truncation banner background |
| `--color-warning-border` | `#E3D2A4` | truncation banner border |
| `--color-warning-text` | `#6B5720` | truncation banner text |
| `--color-notice-bg` | `#EDF1FF` | copyright-notice ground (~7% accent over white; accent text 5.0:1, accent icon/× 5.0:1 vs the 3:1 non-text bar) |

**Accent is used sparingly:** primary button, links, active filter,
selected tile. Nowhere else.

`--color-surface` doubles as the **on-accent text color** — button and
wordmark text on `bg-accent` is `text-surface` on purpose, not a bug.
There is no separate on-accent token; the value is the same `#FFFFFF`.

**`--color-light-muted` is decoration only.** It is ~2.4:1 on
`--color-bg` and fails WCAG AA for text at every size. Legal uses:
dividers, disabled states, placeholder glyphs. **Never** body, label, or
caption text — use `--color-muted` for any text that must be read.

**`--color-overlay`** (`rgb(17 17 17 / 0.5)`) is the scrim behind the mobile
filter sheet, and **`--color-overlay-strong`** (`rgb(17 17 17 / 0.7)`) is the
measured dimension-badge ground — dark enough that `--color-surface` text
holds ≥7:1 even over a pure-white image. Both derive from `--color-text` and
are the only intentionally semi-transparent tokens; neither is in the hex
table above (not 6-digit hex), which is also why doc-sync layer 3 skips them.

## Type

Sans (`--font-sans`) for body and headings — **Schibsted Grotesk**. Mono
(`--font-mono`) for **section labels, badges, and metadata** — **IBM Plex
Mono** — with the exact scope pinned by the Mono's-scope rule below (option
rows are sans; this sentence used to claim "all counts and labels" and
contradicted it). Both are self-hosted, latin-subset, variable woff2 with a
metric-matched fallback face and the system stack last, all inside the one
token; see README for licences.

**Available weights are a constraint, not a coincidence.** The sans face
ships **400–700 only** (the range the site uses; instanced to hit the byte
budget) and mono ships **400 only**. The sans range is a **variable axis**:
every intermediate weight inside it is real — `font-medium` (500, the tile
title) renders true Medium, not a synthetic. A `font-weight` outside those
ranges does not fail — it silently falls back to the nearest available
weight. If you need 800/900 sans or a second mono weight, re-instance the
subset and raise the byte budget; do not just write the weight and assume it
renders.

Scale (px): 88 / 48 / 32 / 20 / 16 / 14 / 13 / 11 —
`display / h1 / h2 / h3 / body / small / caption / label`.

- Display and h1: line-height 1.05, letter-spacing −0.02em.
- Body: line-height 1.5.
- Labels (`text-label`): mono, 11px, **uppercase**, tracking 0.08em.
  Uppercase is applied at the use-site (`uppercase` utility); the token
  carries size, line-height, and tracking.
- **Mono's scope (2026-08-10):** mono is for **section labels, badges, and
  metadata** — sidebar section headings, tile chips/tags, counts *outside*
  option rows, footnotes — and **never for interactive option text**. Sidebar
  option rows (format names, their counts, sort options, source groups,
  display labels) are **sans at `text-small`** (14px): body size is for
  prose, and a dense filter list at 16px would compete with the grid.

## Spacing, radius, borders

- Spacing scale: **8 / 16 / 24 / 40 / 64 / 120** (`--spacing-xs` … `--spacing-2xl`).
  Tailwind's default numeric scale is still enabled only because the
  pre-token components use it; it is retired in the restyle step. New code
  uses the six values only.
- Radius: **a complete named set of three** (2026-08-10, replacing "4px only"):
  `--radius-sm` **2px** (small controls — the tile download square) ·
  `--radius-md` **4px** (**the default** — tiles, wells, inputs, buttons,
  chips) · `--radius-full` **9999px** (the toggle track and knob only). A
  fourth value needs raising before it exists. The `@theme` block wipes the
  `--radius-*` namespace first — otherwise a stray `rounded-lg` would render
  Tailwind's own 8px default; after the wipe a stray alias generates no CSS
  at all, and `verify-landing` rejects `rounded-(xs|lg|xl|2xl|3xl)` in
  markup so it fails loudly rather than rendering square.
- Borders: 1px, `--color-border`, always.

## Layout constants

**Reading surfaces vs scanning surfaces — the rule for picking a width.**
`--container-content` (1280px) caps READING surfaces: pages where measured
line length matters — the landing, and any future prose page. The results
grid is FULL-BLEED (viewport minus `--layout-results-pad`, 40px from `md`,
`--spacing-sm` below) because it is a SCANNING surface: density and tile
size matter, line length does not. Beyond its derived maximum (sidebar +
four capped tiles + gaps + pads) the results SHELL centres as a unit —
sidebar and grid stay adjacent, margins split evenly outside the pair;
centring the grid *within* the shell is a different, rejected decision
(it detaches tiles from the filters). A new page picks by which kind of
surface it is; do not widen `--container-content` to help a grid or cap a
grid to match prose.

Content max-width 1280px (`max-w-content`) · message column 34rem
(`--container-message` → `max-w-message`, for centered state messages) ·
sidebar 260px (`--layout-sidebar`) · grid gutter 24px (`--layout-gutter`) ·
sticky bar 64px (`--layout-stickybar`) · landing demo-grid height 1040px
(`--layout-demo` — derived from the demo grid's final content; changes if
that section's contents change) · results tile floor 220px
(`.results-grid` — FIXED column counts, not auto-fill: 2 below `64rem`
(mobile, and the 48–64rem band where the sidebar mounts), 3 from `64rem`,
4 from `80rem`; tiles stretch so wide screens get BIGGER tiles, not more,
capped at `--layout-tile-max` 400px with the grid LEFT-ALIGNED — scanning
anchors top-left and the tiles stay adjacent to the sidebar; uncapped,
2560px gave 539px gallery tiles) · `--layout-tile-min` 220px is no longer
a grid floor — retained solely as the content-visibility placeholder in
`.result-tile` · results shell padding 40px from `md`
(`--layout-results-pad` — the single tuning knob for the results margins;
the shell's centring max derives from it) · tile reveal cap **120**
(`TILE_REVEAL_CAP` in `src/lib/results-model.ts`).

**Tile corners:** on results tiles the **dimension chip is top-right** and the
**selection checkbox is top-left** — opposite corners. There is **no source
badge** on the tile; source is a sidebar filter, which is where it does its work.

## Results view

- **Sidebar** is `--layout-sidebar` (260px) wide, applied via inline
  `style={{ width: 'var(--layout-sidebar)' }}` (a CSS var, not an arbitrary
  utility), on **`--color-surface`** with hairline dividers between its
  sections and a hairline (`border-r`) to the grid area, which sits on the
  body's **`--color-bg`**. The grid area is `flex-1 min-w-0` beside it; its
  "Showing X of Y" header is right-aligned mono `text-label`.
- **Copyright notice** (in the island, above the grid): accent text on
  `--color-notice-bg`, info icon left, dismiss × right. **Dismissal is state,
  never storage — it reappears on every scan** (definition of done: the notice
  lives where downloads happen).
- **No filename search control** (removed 2026-08-10 per design): the
  capability stays in `results-model.ts` (`query` in `FilterState`, tested);
  the island passes `''`.
- **Whole-tile selection.** The tile is the control (`role="button"`,
  `aria-pressed`): pointer or keyboard (Enter/Space) toggles it, shift-click
  extends a range across the current filtered+sorted order. The checkbox
  (`.tile-check`, 20×20) is a visual indicator, not a separate control — its
  unselected state keeps a `--color-muted` border on a solid surface chip so it
  holds its edge over white images; the disabled download button stops
  propagation so it never toggles.
- **Selected frame is a 2px `--color-accent` border on the tile** (`border-2`;
  unselected is `border-2 --color-border` — same thickness both states, so
  selection causes no layout shift, and the unselected tile has a visible
  edge), **not an outline**.
  `content-visibility: auto` establishes paint containment, under which an inset
  outline renders unevenly (thin top, doubled bottom — the containment box's
  bottom edge doesn't coincide with the border box); a border is integral to the
  box and always uniform. The keyboard **focus ring** is an outset 2px accent
  outline, and `.result-tile:focus-visible` lifts `content-visibility` on the
  focused tile so the outline isn't clipped (one tile focused at a time — no perf
  cost). Never a shadow. The same 2px accent outline at 2px offset rides
  **every control**, including all selection-bar buttons (brought into line
  by the 2026-08-10 keyboard audit — they were the one class left on the
  UA-default 1px ring). **One deliberate exception:** the source chip's URL
  input signals focus with its **border**, not an outline — changing it
  risks the field-sizing behaviour for no user-visible gain. Recorded
  because an outline-only audit will misread that field as having no focus
  affordance; it has one, built by another mechanism. Look at it.
- **Image well** (`.tile-well`, 262:180): deliberately not square — the ratio
  sits between 4:3 and 16:9 so the dominant photo shapes fill it with a mild
  crop under `object-cover` instead of letterboxing. `--color-surface` ground
  (the page sits on `--color-bg`; `body` carries it in `global.css`), hairline
  border, no inner padding. **Icon carve-out:** sources in `ICON_SOURCES`
  (favicon, inline-svg) render `object-contain` at natural size — cover would
  upscale a 32px raster favicon into mush.
- **Dimension chip** (top-right): `bg-overlay-strong` for **measured**
  dimensions, solid `bg-muted` for **declared** ones, `--color-surface` text on
  both — worst-case contrast 7.1:1 (measured, over pure white) and a constant
  5.3:1 (declared), both AA at `text-label`. Absent entirely when nothing is
  known yet — no placeholder, no em dash — appearing once `naturalWidth`
  resolves. It is the checkbox's **pair**: same 20px height (`.tile-chip`),
  same `--radius-md`, same `--spacing-xs` corner inset.
- **Tile footer** (`.tile-footer`, 56px, on `--color-surface`): filename in
  sans `text-caption` `font-medium`, truncated with the full value on hover;
  the format tag beneath it as a solid `--color-bg` chip (`text-label` mono);
  a bordered square download anchor (`.tile-download`, 28×28) at the right,
  centred against the two lines — live since Phase 3 step 2 (`text-muted`,
  hover border/text to `--color-text` per the interaction rules; it stops
  propagation so it never toggles selection).
- **Tile component constants** (from the tile design, defined in `global.css`):
  checkbox `.tile-check` 20×20 · download `.tile-download` 28×28 · footer
  `.tile-footer` 56px · well `.tile-well` 262:180. The design's off-scale
  spacings map to tokens: 10px insets and 12px paddings/gaps → `--spacing-xs`;
  chip micro-paddings (6/3, 4/2) → `px-xs` with zero vertical (the landing
  demo's badge pattern).
- **Controls follow one rule:** checkboxes and radios are for **filtering**
  (format, source, sort); the **pill switch** (`.toggle`, `role="switch"`) is
  for a **display mode** (invert background). The sort-direction control is
  a **text toggle button** ("↓ Largest first" / "↑ Smallest first"), not a
  pill: a direction is two named values of a sort parameter, not an on/off
  mode — a labelled button states its current value, which a pill cannot.
- **Sort group:** one row per key (Document order · Image size · Width ·
  Height · Name · Type) with the direction toggle applied to the metric
  sorts — never Largest/Smallest as doubled rows. "Image size" means
  DIMENSIONS (area); FILE size (bytes) lives only in the selection bar —
  the two are deliberately named apart. Metric rows carry "n of m" known
  counts; "Measure dimensions (N)" appears under the group when the active
  metric has unmeasured probeable entries, with the hourly-allowance note
  past `MEASURE_WARN_AT`. Filter checkboxes/radios are
  native `<input>`s tinted with `accent-accent`; the source-group filter is a
  native `<details>`, collapsed by default, so its chevron is the browser's
  own.
- **The pill switch is the canonical display-mode control.** Track **32×18**
  at `--radius-full`; knob **14×14 circle** at a 2px inset, 14px travel. Off:
  track `--color-border`, knob `--color-surface`; on: track `--color-accent`,
  knob `--color-surface`. The visual is exactly that size; a `::before`
  expander (`inset: -13px -6px`) gives it a **44×44 hit area** with no visual
  or layout change. The landing demo's Invert BG is an older **pressed-chip
  button** that predates this rule — do not copy it into new components;
  whether the demo migrates to the pill is an open decision, deliberately not
  folded into a results change.
- **The format filter shows the full supported set always** (`canonicalFormats`)
  — a format absent from the manifest, or zeroed by another filter, renders
  disabled and `--color-light-muted`, **never removed**, so the list can't reflow
  under the pointer. `jpeg` reads JPG; the union's fallback member `unknown`
  reads UNKNOWN (there is no OTHER). Faceted counts reflect the set filtered by
  the *other* groups.
- **`.result-tile`** carries `content-visibility: auto` +
  `contain-intrinsic-size: auto var(--layout-tile-min)` so off-screen tiles skip
  rendering; tiles share one shape (fixed-ratio well + fixed footer), so the
  placeholder is near-exact at the tile floor and `auto` corrects it after the
  first render.
- **Invert background** reuses `--color-text` as the tile ground — the same swap
  the landing demo uses; no new colour.

### Mobile (below `md`, 48rem)

- **Header** drops to wordmark-only below `sm`: the four-item nav can't sit
  beside the wordmark at 390px, so `<nav>` is `hidden sm:block`. Shared
  `SiteHeader` on both / and /results (pass `anchorPrefix="/"` off the landing so
  the nav anchors point back to it).
- **/results** uses the compact `ScanForm` variant — a SOURCE row: label, the URL
  as a bordered chip with a clear × (a link to a bare /results), and a Re-scan
  URL link. The big hero input stays on /. The chip sizes to its content via
  `field-sizing: content` (`.source-input`, 48ch cap); browsers without it get a
  fixed 28ch chip whose value ellipsizes — deliberate truncation, not a broken
  control.
- The 260px sidebar can't exist at 390px, so the same `ResultsSidebar` mounts
  twice: a `hidden md:block` desktop aside, and a **bottom sheet** opened by the
  Filters trigger in the selection bar. Both share one state; each gets an
  `instanceId` so the search `id` and sort-radio `name` stay unique.
- **`.results-grid`** is 2-up on phones and switches to the auto-fill grid at
  `md`.
- **`.selection-bar`** is three rows on phones (row 1 the four actions; row 2
  the count + size + Calculate/Sizing controls on their own row, so the probe
  strings can never crowd the chrome; row 3 the Filters trigger + Download), a
  single row from `md`. Mobile height is `calc(var(--layout-stickybar) * 2)`.
- **`.filter-sheet`** is a native `<dialog>` shown with `showModal()`
  (since the 2026-08-10 keyboard audit: the platform provides the focus
  trap, Escape-to-close, page inertness, and focus-restore-to-trigger that
  the previous scrim+div only claimed via `aria-modal`). Fixed,
  `max-height: 70vh`, stopping `calc(var(--layout-stickybar) * 2)` off the
  bottom (matching the mobile selection-bar height — the two values must
  move together) so that bar stays visible — visible but **inert** — while
  the sheet is open. The old scrim is now `::backdrop`
  (`--color-overlay`); clicking it closes (a backdrop click targets the
  dialog element). Clear/Apply sit at the sheet's base; filters are live,
  so Apply only dismisses.

## Interaction

- **Hover** changes border-color and text color only. No transform, no
  shadow, no scale.
- **Focus:** 2px `--color-accent` ring at 2px offset, always visible.

## Tiles

Tiles on `/results` are **uniform** — every well is the same **262:180**
ratio (`.tile-well`; see Results view). The 2026-08-08 uniformity decision
stands; what changed (2026-08-09) is the shape: square wells letterboxed
every non-square image. Masonry is used only in the landing-page demo grid.

## Component class names

Don't name a component class the same as a Tailwind utility — the utility
wins and silently overrides your scoped CSS. The demo grid's `class="grid"`
was shadowed by Tailwind's `.grid` (`display: grid`), which killed its
`column-count` masonry; renaming to `masonry` fixed it. Use distinctive
names (`masonry`, `tilebtn`, not `grid`, `flex`, `hidden`).

## NEVER

Gradients · glows · box-shadows · dark theme · purple/violet · any radius
outside the named set (sm 2 / md 4 / full) · any hex value outside
`global.css`.
