import { useState } from 'react';
import type { ScanImage } from '../lib/extract';
import { ICON_SOURCES, downloadHref, formatLabel, proxyUrl } from '../lib/results-model';

/**
 * One grid cell — the whole tile is the selection control (role=button):
 * pointer or keyboard (Enter/Space) toggles it, shift-click extends a range
 * (handled by the parent against the filtered+sorted order). The <img> points
 * DIRECTLY at the origin URL — the zero-cost path the cost model rests on;
 * loading="lazy" keeps 1,000 thumbnails from hammering origins.
 *
 * Failure state lives in the PARENT (the fallback prop), never here: tiles
 * unmount on filter changes (measured — a filter round trip re-requests
 * remounted images), so local failure state would retry dead URLs on every
 * filter flip. On a direct-load error the parent flips this tile to 'proxy'
 * (one retry through /api/proxy — same-origin, inline GET) and on a proxy
 * error to 'dead', which renders "preview unavailable" and mounts NO img at
 * all, so a dead tile never re-requests anything.
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
  fallback,
  onToggle,
  onMeasured,
  onImageError,
}: {
  image: ScanImage;
  selected: boolean;
  invert: boolean;
  fallback: 'proxy' | 'dead' | undefined;
  onToggle: (id: string, shift: boolean) => void;
  onMeasured: (id: string, width: number, height: number) => void;
  onImageError: (image: ScanImage) => void;
}) {
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const isIcon = ICON_SOURCES.has(image.source);
  // The proxy src is derived, not stored — the parent map holds only status.
  const src = fallback === 'proxy' ? proxyUrl(image.url) : image.url;

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
        // Only when the TILE itself is focused — the download anchor inside
        // bubbles its keydown here, and Enter on it must download, not toggle.
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); // Space would otherwise scroll the page
          onToggle(image.id, event.shiftKey);
        }
      }}
      className={`result-tile flex cursor-pointer flex-col rounded-md border-2 bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        selected ? 'border-accent' : 'border-border'
      }`}
    >
      {/* Image well: fills the tile width, hairline border, no inner padding.
          Invert swaps the ground to --color-text so a white-on-transparent logo
          stays visible (same swap as the landing demo). */}
      <div
        className={`tile-well relative overflow-hidden rounded-md border border-border ${
          invert ? 'bg-text' : 'bg-surface'
        }`}
      >
        {fallback === 'dead' ? (
          <span className="absolute inset-0 flex items-center justify-center px-xs text-center font-mono text-label text-muted">
            preview unavailable
          </span>
        ) : (
          <img
            /* key swaps the element on src change so the proxy retry starts
               from a clean node, not one with a pending error state. Between
               the direct failure and the proxy paint the well ground shows —
               the same neutral hold as any tile before first paint. */
            key={src}
            src={src}
            alt={image.filename}
            /* Direct loads stay lazy (the cost model). The fallback img is
               eager: onerror only fires for images whose load was attempted,
               i.e. tiles already in or near the viewport — lazy would just
               re-defer an on-screen image. */
            loading={fallback === 'proxy' ? undefined : 'lazy'}
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
            onError={() => onImageError(image)}
          />
        )}

        {/* Selection indicator, top-left: accent-filled with a stroked SVG
            check when selected (a glyph ✓ renders differently per platform);
            unselected keeps a --color-muted border so the square holds its
            edge over white images. Purely visual — the tile is the button. */}
        <span
          aria-hidden="true"
          className={`tile-check absolute left-xs top-xs flex items-center justify-center rounded-md border ${
            selected ? 'border-accent bg-accent text-surface' : 'border-muted bg-surface text-transparent'
          }`}
        >
          <svg viewBox="0 0 20 20" width="12" height="12" fill="none" aria-hidden="true">
            <path
              d="M4.5 10.5l3.5 3.5 7.5-8"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        {/* Dimension chip, top-right — the checkbox's pair: same 20px height,
            same radius, same corner inset. Strong overlay = measured, solid
            muted = declared; surface text holds AA on both over any image. */}
        {chip !== null && (
          <span
            className={`tile-chip absolute right-xs top-xs inline-flex items-center rounded-md px-xs font-mono text-label text-surface ${
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
          <span className="inline-block w-fit rounded-md bg-bg px-xs font-mono text-label uppercase text-muted">
            {formatLabel(image.ext)}
          </span>
        </div>
        {/* Live on every tile: http(s) through the proxy's attachment path,
            data: URIs downloaded natively via the download attribute. Enabled
            even when the preview is dead — dead means the inline proxy GET
            failed once, which makes success unlikely, not impossible; a
            failed attempt costs one subrequest and the browser reports it. */}
        <a
          href={downloadHref(image)}
          download={image.filename}
          aria-label={`Download ${image.filename}`}
          onClick={(event) => event.stopPropagation()}
          className="tile-download flex shrink-0 items-center justify-center rounded-sm border border-border text-muted hover:border-text hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ↓
        </a>
      </div>
    </li>
  );
}
