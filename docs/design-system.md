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
| `--color-warning-bg` | `#FAF3E3` | truncation banner background |
| `--color-warning-border` | `#E3D2A4` | truncation banner border |
| `--color-warning-text` | `#6B5720` | truncation banner text |

**Accent is used sparingly:** primary button, links, active filter,
selected tile. Nowhere else.

## Type

Sans (`--font-sans`) for body and headings. Mono (`--font-mono`) for **all**
metadata, badges, counts, and labels. Both are system stacks — no webfonts.

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

Content max-width 1280px (`max-w-content`) · sidebar 260px
(`--layout-sidebar`) · grid gutter 24px (`--layout-gutter`) · sticky bar
64px (`--layout-stickybar`) · tile reveal cap **120** (a JS constant —
recorded here, lands in code with the grid-scaling step).

## Interaction

- **Hover** changes border-color and text color only. No transform, no
  shadow, no scale.
- **Focus:** 2px `--color-accent` ring at 2px offset, always visible.

## Tiles

Tiles on `/results` are **uniform `aspect-square`**. Masonry is used only
in the landing-page demo grid.

## NEVER

Gradients · glows · box-shadows · dark theme · purple/violet · any radius
other than 4px · any hex value outside `global.css`.
