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
(`--font-mono`) for **all** metadata, badges, counts, and labels — **IBM
Plex Mono**. Both are self-hosted, latin-subset, variable woff2 with a
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

## Spacing, radius, borders

- Spacing scale: **8 / 16 / 24 / 40 / 64 / 120** (`--spacing-xs` … `--spacing-2xl`).
  Tailwind's default numeric scale is still enabled only because the
  pre-token components use it; it is retired in the restyle step. New code
  uses the six values only.
- Radius: **4px only.** Every `--radius-*` token is pinned to 4px, so even a
  stray `rounded-lg` renders 4px.
- Borders: 1px, `--color-border`, always.

## Layout constants

Content max-width 1280px (`max-w-content`) · message column 34rem
(`--container-message` → `max-w-message`, for centered state messages) ·
sidebar 260px (`--layout-sidebar`) · grid gutter 24px (`--layout-gutter`) ·
sticky bar 64px (`--layout-stickybar`) · landing demo-grid height 1040px
(`--layout-demo` — derived from the demo grid's final content; changes if
that section's contents change) · results tile floor 220px
(`--layout-tile-min` — auto-fill columns via inline
`repeat(auto-fill, minmax(var(--layout-tile-min), 1fr))`; yields 4 columns
in the post-sidebar grid area, 5 at full width until the sidebar lands) ·
tile reveal cap **120** (a JS constant — recorded here, lands in code with
the grid-scaling step).

**Tile corners:** on results tiles the **dimension chip is top-right** and the
**selection checkbox is top-left** — opposite corners. There is **no source
badge** on the tile; source is a sidebar filter, which is where it does its work.

## Results view

- **Sidebar** is `--layout-sidebar` (260px) wide, applied via inline
  `style={{ width: 'var(--layout-sidebar)' }}` (a CSS var, not an arbitrary
  utility). The grid area is `flex-1 min-w-0` beside it.
- **Whole-tile selection.** The tile is the control (`role="button"`,
  `aria-pressed`): pointer or keyboard (Enter/Space) toggles it, shift-click
  extends a range across the current filtered+sorted order. The checkbox
  (`.tile-check`, 20×20) is a visual indicator, not a separate control — its
  unselected state keeps a `--color-muted` border on a solid surface chip so it
  holds its edge over white images; the disabled download button stops
  propagation so it never toggles.
- **Selected frame is a 2px `--color-accent` border on the tile** (`border-2`,
  transparent when unselected → no layout shift), **not an outline**.
  `content-visibility: auto` establishes paint containment, under which an inset
  outline renders unevenly (thin top, doubled bottom — the containment box's
  bottom edge doesn't coincide with the border box); a border is integral to the
  box and always uniform. The keyboard **focus ring** is an outset 2px accent
  outline, and `.result-tile:focus-visible` lifts `content-visibility` on the
  focused tile so the outline isn't clipped (one tile focused at a time — no perf
  cost). Never a shadow.
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
  resolves.
- **Tile footer** (`.tile-footer`, 56px, on `--color-surface`): filename in
  sans `text-caption` `font-medium`, truncated with the full value on hover;
  the format tag beneath it as a solid `--color-bg` chip (`text-label` mono);
  a bordered square download button (`.tile-download`, 28×28) at the right,
  centred against the two lines (disabled until Phase 3).
- **Tile component constants** (from the tile design, defined in `global.css`):
  checkbox `.tile-check` 20×20 · download `.tile-download` 28×28 · footer
  `.tile-footer` 56px · well `.tile-well` 262:180. The design's off-scale
  spacings map to tokens: 10px insets and 12px paddings/gaps → `--spacing-xs`;
  chip micro-paddings (6/3, 4/2) → `px-xs` with zero vertical (the landing
  demo's badge pattern).
- **Controls follow one rule:** checkboxes and radios are for **filtering**
  (format, source, sort); a **switch** (`.toggle`, `role="switch"`, dimensions
  from spacing tokens, squared to the 4px radius) is for a **display mode**
  (invert background). Filter checkboxes/radios are native `<input>`s tinted with
  `accent-accent`; the source-group filter is a native `<details>`, collapsed by
  default, so its chevron is the browser's own.
- **The pill switch is the canonical display-mode control.** Track
  `--color-border` off / `--color-accent` on; knob `--color-muted` off /
  `--color-surface` on (a surface track's hairline vanished on the surface
  sidebar and the control read as a bare grey knob). The landing demo's
  Invert BG is an older **pressed-chip button** that predates this rule — do
  not copy it into new components; whether the demo migrates to the pill is an
  open decision, deliberately not folded into a results change.
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
- **`.selection-bar`** is two rows on phones (row 1 the four actions; row 2 the
  Filters trigger + count/size on the left and Download on the right), a single
  row from `md`. Mobile height is `calc(var(--layout-stickybar) * 1.5)`.
- **`.filter-sheet`** is `fixed`, `max-height: 70vh`, stopping
  `calc(var(--layout-stickybar) * 1.5)` off the bottom (matching the mobile
  selection-bar height) so that bar stays visible while it's open. `.filter-scrim`
  (`--color-overlay`) dims the content behind at `z 20`, below the bottom chrome
  (`z 30`) and the sheet (`z 40`). Clear/Apply sit at the sheet's base; filters
  are live, so Apply only dismisses.

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
other than 4px · any hex value outside `global.css`.
