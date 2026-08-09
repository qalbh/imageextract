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

## Type

Sans (`--font-sans`) for body and headings — **Schibsted Grotesk**. Mono
(`--font-mono`) for **all** metadata, badges, counts, and labels — **IBM
Plex Mono**. Both are self-hosted, latin-subset, variable woff2 with a
metric-matched fallback face and the system stack last, all inside the one
token; see README for licences.

**Available weights are a constraint, not a coincidence.** The sans face
ships **400–700 only** (the range the site uses; instanced to hit the byte
budget) and mono ships **400 only**. A `font-weight` outside those ranges
does not fail — it silently falls back to the nearest available weight. If
you need 800/900 sans or a second mono weight, re-instance the subset and
raise the byte budget; do not just write the weight and assume it renders.

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

**Tile badge corners:** on results tiles the **source badge is top-right**
and the **selection checkbox is top-left** — opposite corners so they never
collide.

## Results view

- **Sidebar** is `--layout-sidebar` (260px) wide, applied via inline
  `style={{ width: 'var(--layout-sidebar)' }}` (a CSS var, not an arbitrary
  utility). The grid area is `flex-1 min-w-0` beside it.
- **Selection bar** is a sticky bottom bar, `--layout-stickybar` (64px) tall,
  `bg-surface` with a top `border-border`.
- **Form controls** (filter checkboxes, sort radios, the invert toggle) are
  native `<input>`s tinted with `accent-accent` (`accent-color: --color-accent`)
  — no custom control chrome. The source-group filter is a native `<details>`
  disclosure, collapsed by default, so its chevron is the browser's own.
- **Selected tile** uses `.tile-selected` — a 2px `--color-accent` outline at
  `outline-offset: -2px` (drawn *inside* the border box so `content-visibility`
  paint containment can't clip it), plus `border-accent`. An outline, never a
  shadow.
- **`.result-tile`** carries `content-visibility: auto` +
  `contain-intrinsic-size: auto var(--layout-tile-min)` so off-screen tiles skip
  rendering; the uniform square makes the intrinsic size accurate.
- **Faceted filter counts:** a filter row whose count is zero under the other
  active filters renders disabled and `--color-light-muted`, never removed — the
  list must not reflow while the pointer is aiming at a row.
- **Invert background** reuses `--color-text` as the tile ground (and
  `--color-surface` for the caption on it) — the same swap the landing demo
  uses; no new colour.

## Interaction

- **Hover** changes border-color and text color only. No transform, no
  shadow, no scale.
- **Focus:** 2px `--color-accent` ring at 2px offset, always visible.

## Tiles

Tiles on `/results` are **uniform `aspect-square`**. Masonry is used only
in the landing-page demo grid.

## Component class names

Don't name a component class the same as a Tailwind utility — the utility
wins and silently overrides your scoped CSS. The demo grid's `class="grid"`
was shadowed by Tailwind's `.grid` (`display: grid`), which killed its
`column-count` masonry; renaming to `masonry` fixed it. Use distinctive
names (`masonry`, `tilebtn`, not `grid`, `flex`, `hidden`).

## NEVER

Gradients · glows · box-shadows · dark theme · purple/violet · any radius
other than 4px · any hex value outside `global.css`.
