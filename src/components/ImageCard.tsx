import { useState } from 'react';
import type { ScanImage } from '../lib/extract';

/**
 * One grid cell. The <img> points DIRECTLY at the origin URL — never the
 * proxy. This is the zero-cost path the whole cost model rests on;
 * loading="lazy" is part of the same bargain, since eagerly fetching 1,000
 * direct thumbnails would hammer the origin on render.
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
  onToggle: (id: string) => void;
  onMeasured: (id: string, width: number, height: number) => void;
}) {
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  // Two weights: measured dimensions (naturalWidth/Height, load-time truth)
  // render full weight; page-declared dimensions render muted because pages go
  // stale and lie; nothing known shows an em dash.
  const dimText = measured
    ? `${measured.w}×${measured.h}`
    : image.width !== undefined && image.height !== undefined
      ? `${image.width}×${image.height}`
      : image.width !== undefined
        ? `${image.width}`
        : '—';
  const dimClass = measured ? 'text-text' : 'text-muted';

  return (
    <li
      className={`result-tile flex flex-col overflow-hidden rounded-sm border bg-surface ${
        selected ? 'tile-selected border-accent' : 'border-border'
      }`}
    >
      {/* The img is absolutely positioned so a very tall intrinsic size
          (sprite sheets, strip SVGs) cannot stretch the square box — with
          in-flow content, min-height:auto lets the image blow up the row.
          Invert swaps the ground to --color-text so a white-on-transparent
          logo stays visible (ported from the landing demo's invert toggle). */}
      <div
        className={`relative flex aspect-square items-center justify-center ${invert ? 'bg-text' : 'bg-bg'}`}
      >
        {failed ? (
          <span className="px-xs text-center font-mono text-label text-muted">preview unavailable</span>
        ) : (
          <img
            src={image.url}
            alt={image.filename}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              // SVGs without an intrinsic size report 0×0 — show nothing
              // rather than a lie.
              if (naturalWidth > 0 && naturalHeight > 0) {
                setMeasured({ w: naturalWidth, h: naturalHeight });
                onMeasured(image.id, naturalWidth, naturalHeight);
              }
            }}
            onError={() => setFailed(true)}
          />
        )}
        {/* Selection checkbox, top-left. Native input tinted with the accent
            token; opposite corner from the source badge so they never collide. */}
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(image.id)}
          aria-label={`Select ${image.filename}`}
          className="absolute left-xs top-xs z-10 accent-accent"
        />
        {/* Source badge, top-right. Raw ImageSource value; no competitor
            surfaces it. Dark chip stays legible over any photo. */}
        <span className="absolute right-xs top-xs rounded-sm bg-text px-xs font-mono text-label uppercase text-surface">
          {image.source}
        </span>
      </div>
      <div className="flex flex-col gap-xs p-xs">
        <div className="flex items-center gap-xs">
          <span className="min-w-0 flex-1 truncate font-mono text-label text-text" title={image.filename}>
            {image.filename}
          </span>
          {/* Single-image download is Phase 3 (proxy). Rendered disabled, to
              match the disabled Download ZIP in the selection bar — never a
              button that looks live but does nothing. */}
          <button
            type="button"
            disabled
            aria-label="Download (ships with the download release)"
            title="Single-image download ships with the download release"
            className="shrink-0 font-mono text-label text-light-muted"
          >
            ↓
          </button>
        </div>
        <span className="flex gap-xs font-mono text-label uppercase">
          <span className={dimClass}>{dimText}</span>
          <span className="text-muted">{image.ext === 'unknown' ? '?' : image.ext}</span>
          {/* Byte size stays an em dash until probing ships — no HEAD fired. */}
          <span className="text-muted">{'—'}</span>
        </span>
      </div>
    </li>
  );
}
