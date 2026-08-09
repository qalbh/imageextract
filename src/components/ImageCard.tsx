import { useState } from 'react';
import type { ScanImage } from '../lib/extract';
import { formatLabel } from '../lib/results-model';

/**
 * One grid cell — the whole tile is the selection control (role=button):
 * pointer or keyboard (Enter/Space) toggles it, shift-click extends a range
 * (handled by the parent against the filtered+sorted order). The <img> points
 * DIRECTLY at the origin URL — never the proxy — the zero-cost path the cost
 * model rests on; loading="lazy" keeps 1,000 thumbnails from hammering origins.
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

  // Dimension chip. Measured (load-time truth) renders on the dark chip at full
  // weight; page-declared values render on a muted chip. When nothing is known
  // yet the chip is ABSENT — no placeholder, no em dash — and appears once
  // naturalWidth resolves on load.
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
      className={`result-tile flex cursor-pointer flex-col gap-xs rounded-sm border-2 bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        selected ? 'border-accent' : 'border-transparent'
      }`}
    >
      {/* Image area: fills the tile width, hairline border, no inner padding.
          Invert swaps the ground to --color-text so a white-on-transparent logo
          stays visible (ported from the landing demo's invert toggle). */}
      <div
        className={`relative aspect-square overflow-hidden rounded-sm border border-border ${
          invert ? 'bg-text' : 'bg-bg'
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
            className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
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
            selected, empty bordered square otherwise. Purely visual — the whole
            tile is the button, so this is not a separate focusable control. */}
        <span
          aria-hidden="true"
          className={`absolute left-xs top-xs flex size-sm items-center justify-center rounded-sm border font-mono text-label ${
            selected ? 'border-accent bg-accent text-surface' : 'border-border bg-surface text-transparent'
          }`}
        >
          ✓
        </span>

        {/* Dimension chip, top-right. Dark = measured, muted = declared. */}
        {chip !== null && (
          <span
            className={`absolute right-xs top-xs rounded-sm px-xs font-mono text-label text-surface ${
              chipMeasured ? 'bg-text' : 'bg-muted'
            }`}
          >
            {chip}
          </span>
        )}
      </div>

      {/* Footer, on --color-surface: filename, then the format label; the
          disabled download button (Phase 3) sits at the right, centred. */}
      <div className="flex items-center justify-between gap-xs px-xs pb-xs">
        <div className="min-w-0">
          <p className="truncate font-mono text-label text-text" title={image.filename}>
            {image.filename}
          </p>
          <p className="font-mono text-label uppercase text-muted">{formatLabel(image.ext)}</p>
        </div>
        <button
          type="button"
          disabled
          aria-label="Download (ships with the download release)"
          title="Single-image download ships with the download release"
          onClick={(event) => event.stopPropagation()}
          className="flex size-lg shrink-0 items-center justify-center rounded-sm border border-border text-light-muted"
        >
          ↓
        </button>
      </div>
    </li>
  );
}
