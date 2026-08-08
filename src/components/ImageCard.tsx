import { useState } from 'react';
import type { ScanImage } from '../lib/extract';

/**
 * One grid cell. The <img> points DIRECTLY at the origin URL — never the
 * proxy. This is the zero-cost path the whole cost model rests on;
 * loading="lazy" is part of the same bargain, since eagerly fetching 1,000
 * direct thumbnails would hammer the origin on render.
 */
export default function ImageCard({ image }: { image: ScanImage }) {
  const [dimensions, setDimensions] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  return (
    <li className="flex flex-col overflow-hidden rounded-sm border border-border bg-surface">
      {/* The img is absolutely positioned so a very tall intrinsic size
          (sprite sheets, strip SVGs) cannot stretch the square box — with
          in-flow content, min-height:auto lets the image blow up the row. */}
      <div className="relative flex aspect-square items-center justify-center bg-bg">
        {failed ? (
          <span className="px-xs text-center font-mono text-label text-muted">
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
              // SVGs without an intrinsic size report 0×0 — show nothing
              // rather than a lie.
              if (naturalWidth > 0 && naturalHeight > 0) {
                setDimensions(`${naturalWidth}×${naturalHeight}`);
              }
            }}
            onError={() => setFailed(true)}
          />
        )}
        {/* Source badge, top-right. Raw ImageSource value; no competitor
            surfaces it. Top-left is reserved for the selection checkbox
            (next pass), so the two never collide. Dark chip stays legible
            over any photo. */}
        <span className="absolute right-xs top-xs rounded-sm bg-text px-xs font-mono text-label uppercase text-surface">
          {image.source}
        </span>
      </div>
      <div className="flex flex-col gap-xs p-xs">
        <span className="truncate font-mono text-label text-text" title={image.filename}>
          {image.filename}
        </span>
        <span className="flex gap-xs font-mono text-label uppercase text-muted">
          <span>{dimensions ?? '…'}</span>
          <span>{image.ext === 'unknown' ? '?' : image.ext}</span>
          {/* Byte size stays an em dash until probing ships — no HEAD fired. */}
          <span>{'—'}</span>
        </span>
      </div>
    </li>
  );
}
