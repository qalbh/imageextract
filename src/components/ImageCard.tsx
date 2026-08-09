import { useState } from 'react';
import type { ScanImage } from '../lib/extract';
import { ICON_SOURCES, formatLabel } from '../lib/results-model';

/**
 * One grid cell — the whole tile is the selection control (role=button):
 * pointer or keyboard (Enter/Space) toggles it, shift-click extends a range
 * (handled by the parent against the filtered+sorted order). The <img> points
 * DIRECTLY at the origin URL — never the proxy — the zero-cost path the cost
 * model rests on; loading="lazy" keeps 1,000 thumbnails from hammering origins.
 *
 * The well is 262:180 with object-cover — a preview crops rather than
 * letterboxes. Icon sources (ICON_SOURCES: favicon, inline-svg) are the
 * carve-out: they render contain at natural size, because cover would upscale
 * a 32px raster favicon to fill the well.
 */
export default function ImageCard({
  image,
  selected,
  invert,
  onToggle,
  onMeasured,
}: {
  image: ScanImage;
  selected: boolean;
  invert: boolean;
  onToggle: (id: string, shift: boolean) => void;
  onMeasured: (id: string, width: number, height: number) => void;
}) {
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const isIcon = ICON_SOURCES.has(image.source);

  // Dimension chip. Measured (load-time truth) renders on the strong overlay
  // chip; page-declared values render on a solid muted chip. When nothing is
  // known yet the chip is ABSENT — no placeholder, no em dash — and appears
  // once naturalWidth resolves on load.
  let chip: string | null = null;
  let chipMeasured = false;
  if (measured) {
    chip = `${measured.w}×${measured.h}`;
    chipMeasured = true;
  } else if (image.width !== undefined && image.height !== undefined) {
    chip = `${image.width}×${image.height}`;
  } else if (image.width !== undefined) {
    chip = `${image.width}`;
  }

  return (
    <li
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${selected ? 'Deselect' : 'Select'} ${image.filename}`}
      onClick={(event) => onToggle(image.id, event.shiftKey)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); // Space would otherwise scroll the page
          onToggle(image.id, event.shiftKey);
        }
      }}
      className={`result-tile flex cursor-pointer flex-col rounded-sm border-2 bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        selected ? 'border-accent' : 'border-transparent'
      }`}
    >
      {/* Image well: fills the tile width, hairline border, no inner padding.
          Invert swaps the ground to --color-text so a white-on-transparent logo
          stays visible (same swap as the landing demo). */}
      <div
        className={`tile-well relative overflow-hidden rounded-sm border border-border ${
          invert ? 'bg-text' : 'bg-surface'
        }`}
      >
        {failed ? (
          <span className="absolute inset-0 flex items-center justify-center px-xs text-center font-mono text-label text-muted">
            preview unavailable
          </span>
        ) : (
          <img
            src={image.url}
            alt={image.filename}
            loading="lazy"
            decoding="async"
            className={
              isIcon
                ? 'absolute inset-0 m-auto max-h-full max-w-full object-contain'
                : 'absolute inset-0 h-full w-full object-cover'
            }
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              // SVGs without an intrinsic size report 0×0 — show no chip rather
              // than a lie.
              if (naturalWidth > 0 && naturalHeight > 0) {
                setMeasured({ w: naturalWidth, h: naturalHeight });
                onMeasured(image.id, naturalWidth, naturalHeight);
              }
            }}
            onError={() => setFailed(true)}
          />
        )}

        {/* Selection indicator, top-left: accent-filled with a check when
            selected; unselected keeps a --color-muted border so the square
            holds its edge over white images. Purely visual — the tile is the
            button. */}
        <span
          aria-hidden="true"
          className={`tile-check absolute left-xs top-xs flex items-center justify-center rounded-sm border font-mono text-label ${
            selected ? 'border-accent bg-accent text-surface' : 'border-muted bg-surface text-transparent'
          }`}
        >
          ✓
        </span>

        {/* Dimension chip, top-right. Strong overlay = measured, solid muted =
            declared; surface text holds AA on both over any image. */}
        {chip !== null && (
          <span
            className={`absolute right-xs top-xs rounded-sm px-xs font-mono text-label text-surface ${
              chipMeasured ? 'bg-overlay-strong' : 'bg-muted'
            }`}
          >
            {chip}
          </span>
        )}
      </div>

      {/* Footer, 56px on --color-surface: filename (sans, medium), format tag
          as a solid --color-bg chip, and the disabled download square
          (Phase 3) centred against both lines. */}
      <div className="tile-footer flex items-center gap-xs px-xs">
        <div className="min-w-0 flex-1">
          <p className="truncate text-caption font-medium text-text" title={image.filename}>
            {image.filename}
          </p>
          <span className="inline-block w-fit rounded-sm bg-bg px-xs font-mono text-label uppercase text-muted">
            {formatLabel(image.ext)}
          </span>
        </div>
        <button
          type="button"
          disabled
          aria-label="Download (ships with the download release)"
          title="Single-image download ships with the download release"
          onClick={(event) => event.stopPropagation()}
          className="tile-download flex shrink-0 items-center justify-center rounded-sm border border-border text-light-muted"
        >
          ↓
        </button>
      </div>
    </li>
  );
}
