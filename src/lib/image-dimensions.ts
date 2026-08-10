import { proxyUrl, type SizeEntry } from './results-model';

/**
 * Dimension probing (client side). Raster dimensions live in the file
 * header, so a single prefix Range through /api/proxy yields exact
 * dimensions — and, via Content-Range's total (or the 200-fallback's
 * Content-Length), the full byte size. One subrequest answers both the
 * dimension and the size question, which is why this REPLACED the HEAD
 * probe rather than joining it.
 *
 * Competitors sort by dimensions with no probe step because a headless
 * browser loads every image during the scan — paying upfront on every scan
 * for every visitor. We pay one prefix request, on demand, for what the
 * user asks about: the same upfront-vs-on-demand tradeoff DECISIONS.md
 * records for static parsing itself.
 */

// One uniform prefix for every format. PNG/GIF/ICO/WebP need <50 bytes;
// JPEG's SOF marker sits after the APP segments and is inside 4 KB for the
// overwhelming majority of files (EXIF-heavy outliers whose SOF sits deeper
// are terminal 'failed' — a follow-up Range would be a second subrequest,
// not worth the tail); AVIF's ispe box and an SVG's width/height attributes
// are likewise almost always inside 4 KB. One size keeps one code path.
export const PROBE_RANGE_BYTES = 4096;

export type ProbedDims = { w: number; h: number } | 'no-intrinsic' | 'failed';

export interface ProbedMeta {
  dims: ProbedDims;
  size: SizeEntry;
}

const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32be = (b: Uint8Array, o: number) =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
const ascii = (b: Uint8Array, o: number, len: number) =>
  String.fromCharCode(...b.subarray(o, o + len));

function pngDims(b: Uint8Array): ProbedDims {
  // Signature (8) + IHDR length/type (8) → width/height at 16..23.
  if (b.length < 24) return 'failed';
  return { w: u32be(b, 16), h: u32be(b, 20) };
}

function gifDims(b: Uint8Array): ProbedDims {
  if (b.length < 10) return 'failed';
  return { w: u16le(b, 6), h: u16le(b, 8) };
}

function icoDims(b: Uint8Array): ProbedDims {
  // ICONDIR (6) then 16-byte entries; report the largest entry. A stored 0
  // means 256 — the format's one quirk.
  if (b.length < 22) return 'failed';
  const count = u16le(b, 4);
  let best: { w: number; h: number } | null = null;
  for (let i = 0; i < count && 6 + (i + 1) * 16 <= b.length; i += 1) {
    const o = 6 + i * 16;
    const w = b[o]! === 0 ? 256 : b[o]!;
    const h = b[o + 1]! === 0 ? 256 : b[o + 1]!;
    if (best === null || w * h > best.w * best.h) best = { w, h };
  }
  return best ?? 'failed';
}

function webpDims(b: Uint8Array): ProbedDims {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return 'failed';
  const fourcc = ascii(b, 12, 4);
  if (fourcc === 'VP8X') {
    // Canvas size, minus-one encoded, 24-bit LE at 24/27.
    return { w: u24le(b, 24) + 1, h: u24le(b, 27) + 1 };
  }
  if (fourcc === 'VP8 ') {
    // Lossy: 14-bit dims at frame-header offset 26, low 14 bits.
    if (b.length < 30) return 'failed';
    return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    // Lossless: signature byte 0x2f then 14+14 bits, minus-one encoded.
    if (b.length < 25 || b[20] !== 0x2f) return 'failed';
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  return 'failed';
}

function jpegDims(b: Uint8Array): ProbedDims {
  // Walk the segment chain to a start-of-frame marker (C0–CF minus C4/C8/CC).
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return 'failed';
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) {
      o += 1; // padding/fill bytes are legal between segments
      continue;
    }
    const marker = b[o + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      o += 2;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // SOFn: length(2) precision(1) height(2) width(2)
      return { w: u16be(b, o + 7), h: u16be(b, o + 5) };
    }
    o += 2 + u16be(b, o + 2);
  }
  return 'failed'; // SOF deeper than the prefix — terminal, no second request
}

function avifDims(b: Uint8Array): ProbedDims {
  // ISOBMFF box walk for the first `ispe` (image spatial extents) box:
  // 12-byte header (size, 'ispe', version/flags) then width/height u32be.
  for (let o = 0; o + 20 <= b.length; o += 1) {
    if (ascii(b, o, 4) === 'ispe') {
      return { w: u32be(b, o + 8), h: u32be(b, o + 12) };
    }
  }
  return 'failed';
}

const SVG_LENGTH = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(px)?\s*$/i;

export function svgDims(text: string): ProbedDims {
  // Absolute px width/height on the root <svg> only; percentages, em, or
  // viewBox-only SVGs have no usable intrinsic pixel size — reported as
  // 'no-intrinsic', the same honesty as the 0×0 naturalWidth chip rule.
  const open = text.match(/<svg[^>]*>/i)?.[0];
  if (!open) return 'failed';
  const attr = (name: string) => open.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1];
  const w = attr('width')?.match(SVG_LENGTH)?.[1];
  const h = attr('height')?.match(SVG_LENGTH)?.[1];
  if (w !== undefined && h !== undefined) return { w: Math.round(+w), h: Math.round(+h) };
  return 'no-intrinsic';
}

/** Sniffs the container from the bytes; the ext hint only breaks ties. */
export function parseDimensions(bytes: Uint8Array, hint?: string): ProbedDims {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return pngDims(bytes);
  if (bytes.length >= 6 && ascii(bytes, 0, 3) === 'GIF') return gifDims(bytes);
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP')
    return webpDims(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegDims(bytes);
  if (bytes.length >= 12 && ['ftyp'].includes(ascii(bytes, 4, 4))) return avifDims(bytes);
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0)
    return icoDims(bytes);
  // Textual? Try SVG regardless of hint — stylesheet-sourced SVGs carry
  // ext 'svg' but any text/xml prefix is worth one look.
  const head = new TextDecoder().decode(bytes.subarray(0, 512));
  if (/<svg[\s>]/i.test(head) || hint === 'svg') return svgDims(new TextDecoder().decode(bytes));
  return 'failed';
}

/** Exact dimensions of a data: URI, locally — zero network. */
export function dataUriDims(url: string): ProbedDims {
  const comma = url.indexOf(',');
  if (comma === -1) return 'failed';
  const header = url.slice(0, comma);
  const payload = url.slice(comma + 1);
  let bytes: Uint8Array;
  if (/;base64$/i.test(header)) {
    try {
      const binary = atob(payload);
      const take = Math.min(binary.length, PROBE_RANGE_BYTES);
      bytes = new Uint8Array(take);
      for (let i = 0; i < take; i += 1) bytes[i] = binary.charCodeAt(i);
    } catch {
      return 'failed';
    }
  } else {
    let text: string;
    try {
      text = decodeURIComponent(payload);
    } catch {
      text = payload;
    }
    bytes = new TextEncoder().encode(text.slice(0, PROBE_RANGE_BYTES * 2));
  }
  return parseDimensions(bytes);
}

/**
 * The unified probe: one prefix Range through the proxy answers BOTH
 * questions. 206 → dims from the prefix, size from Content-Range's total.
 * Range-ignored 200 → dims from the prefix, size from Content-Length, and
 * the reader is CANCELLED after the prefix so the transfer stops — the
 * difference between a 4 KB probe and a 50 MB one.
 * Returns 'canceled' only for the caller's own abort; timeout and errors
 * are 'failed' results that free the queue slot.
 */
export async function probeMeta(
  url: string,
  options: { signal: AbortSignal; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<ProbedMeta | 'canceled'> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), options.timeoutMs ?? 10_000);
  const combined = new AbortController();
  const forward = () => combined.abort();
  options.signal.addEventListener('abort', forward);
  timeout.signal.addEventListener('abort', forward);
  try {
    const response = await fetchImpl(proxyUrl(url), {
      headers: { range: `bytes=0-${PROBE_RANGE_BYTES - 1}` },
      signal: combined.signal,
    });
    if (!response.ok) return { dims: 'failed', size: 'failed' };

    let size: SizeEntry = 'unknown-length';
    const contentRange = response.headers.get('content-range');
    const total = contentRange?.match(/\/(\d+)$/)?.[1];
    if (response.status === 206 && total !== undefined) {
      size = Number(total);
    } else {
      const length = response.headers.get('content-length');
      if (length !== null && Number.isFinite(Number(length))) size = Number(length);
    }

    // Read up to the prefix, then STOP the stream — on a range-ignored 200
    // this cancellation is what keeps the transfer at kilobytes.
    let dims: ProbedDims = 'failed';
    if (response.body !== null) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let got = 0;
      while (got < PROBE_RANGE_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
      }
      await reader.cancel().catch(() => {});
      const bytes = new Uint8Array(got);
      let o = 0;
      for (const c of chunks) {
        bytes.set(c, o);
        o += c.length;
      }
      dims = parseDimensions(bytes);
    }
    return { dims, size };
  } catch {
    return options.signal.aborted ? 'canceled' : { dims: 'failed', size: 'failed' };
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', forward);
  }
}
