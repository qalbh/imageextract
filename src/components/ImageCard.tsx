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
    <li className="flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white">
      {/* The img is absolutely positioned so a very tall intrinsic size
          (sprite sheets, strip SVGs) cannot stretch the square box — with
          in-flow content, min-height:auto lets the image blow up the row. */}
      <div className="relative flex aspect-square items-center justify-center bg-neutral-50">
        {failed ? (
          <span className="px-2 text-center text-xs text-neutral-400">preview unavailable</span>
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
      </div>
      <div className="flex flex-col gap-1 p-2">
        <span className="truncate text-xs text-neutral-700" title={image.filename}>
          {image.filename}
        </span>
        <span className="flex gap-2 text-[11px] text-neutral-500">
          <span className="rounded bg-neutral-100 px-1 uppercase">
            {image.ext === 'unknown' ? '?' : image.ext}
          </span>
          <span>{dimensions ?? '…'}</span>
          {/* Byte size stays an em dash until probing ships — no HEAD fired. */}
          <span>{'—'}</span>
        </span>
      </div>
    </li>
  );
}
