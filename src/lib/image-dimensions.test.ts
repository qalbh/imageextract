import { describe, expect, it } from 'vitest';
import {
  PROBE_RANGE_BYTES,
  dataUriDims,
  parseDimensions,
  probeMeta,
  svgDims,
} from './image-dimensions';

// Hand-built minimal headers — real byte layouts, not fixtures from disk.
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
function gif(w: number, h: number): Uint8Array {
  const b = new Uint8Array(10);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  new DataView(b.buffer).setUint16(6, w, true);
  new DataView(b.buffer).setUint16(8, h, true);
  return b;
}
function jpeg(w: number, h: number): Uint8Array {
  // SOI, APP0 (18 bytes), SOF0
  const b = new Uint8Array(2 + 20 + 10);
  let o = 0;
  b.set([0xff, 0xd8], o);
  o += 2;
  b.set([0xff, 0xe0, 0x00, 0x12], o); // APP0, length 18
  o += 20;
  b.set([0xff, 0xc0, 0x00, 0x08, 0x08], o); // SOF0, length 8, precision 8
  new DataView(b.buffer).setUint16(o + 5, h);
  new DataView(b.buffer).setUint16(o + 7, w);
  return b;
}
function webpVp8x(w: number, h: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  b.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  b.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
  const put24 = (off: number, v: number) => {
    b[off] = v & 0xff;
    b[off + 1] = (v >> 8) & 0xff;
    b[off + 2] = (v >> 16) & 0xff;
  };
  put24(24, w - 1);
  put24(27, h - 1);
  return b;
}
function ico(entries: Array<[number, number]>): Uint8Array {
  const b = new Uint8Array(6 + entries.length * 16);
  new DataView(b.buffer).setUint16(2, 1, true); // type icon
  new DataView(b.buffer).setUint16(4, entries.length, true);
  entries.forEach(([w, h], i) => {
    b[6 + i * 16] = w === 256 ? 0 : w;
    b[7 + i * 16] = h === 256 ? 0 : h;
  });
  return b;
}
function avif(w: number, h: number): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0, 0, 0, 24], 0);
  b.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
  b.set([0x61, 0x76, 0x69, 0x66], 8); // avif brand
  // an ispe box somewhere in the prefix
  const o = 32;
  new DataView(b.buffer).setUint32(o, 20);
  b.set([0x69, 0x73, 0x70, 0x65], o + 4); // 'ispe' — wait, offset: parse scans for the fourcc
  new DataView(b.buffer).setUint32(o + 12, w);
  new DataView(b.buffer).setUint32(o + 16, h);
  return b;
}

describe('parseDimensions', () => {
  it('PNG from the IHDR', () => expect(parseDimensions(png(3840, 2160))).toEqual({ w: 3840, h: 2160 }));
  it('GIF from the screen descriptor', () => expect(parseDimensions(gif(500, 320))).toEqual({ w: 500, h: 320 }));
  it('JPEG by walking APP segments to SOF0', () =>
    expect(parseDimensions(jpeg(1920, 1080))).toEqual({ w: 1920, h: 1080 }));
  it('WebP VP8X canvas (minus-one encoded)', () =>
    expect(parseDimensions(webpVp8x(1200, 800))).toEqual({ w: 1200, h: 800 }));
  it('ICO reports the largest entry, 0 meaning 256', () =>
    expect(parseDimensions(ico([[16, 16], [256, 256], [48, 48]]))).toEqual({ w: 256, h: 256 }));
  it('AVIF from the ispe box', () => {
    const dims = parseDimensions(avif(1024, 768));
    expect(dims).toEqual({ w: 1024, h: 768 });
  });
  it('JPEG whose SOF is beyond the prefix is terminal failed', () => {
    const b = new Uint8Array(64).fill(0);
    b.set([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xfc]); // APP1 claiming a huge length
    expect(parseDimensions(b)).toBe('failed');
  });
  it('garbage is failed', () => expect(parseDimensions(new Uint8Array([1, 2, 3, 4]))).toBe('failed'));
});

describe('svgDims', () => {
  it('absolute px width/height', () =>
    expect(svgDims('<svg width="120" height="80px" xmlns="x"></svg>')).toEqual({ w: 120, h: 80 }));
  it('viewBox-only has no intrinsic pixel size', () =>
    expect(svgDims('<svg viewBox="0 0 100 50"></svg>')).toBe('no-intrinsic'));
  it('percentage sizes have no intrinsic pixel size', () =>
    expect(svgDims('<svg width="100%" height="50%"></svg>')).toBe('no-intrinsic'));
});

describe('dataUriDims', () => {
  it('parses percent-encoded SVG locally', () => {
    const uri = `data:image/svg+xml,${encodeURIComponent('<svg width="40" height="40"></svg>')}`;
    expect(dataUriDims(uri)).toEqual({ w: 40, h: 40 });
  });
  it('parses base64 PNG locally', () => {
    const b64 = btoa(String.fromCharCode(...png(9, 7)));
    expect(dataUriDims(`data:image/png;base64,${b64}`)).toEqual({ w: 9, h: 7 });
  });
});

describe('probeMeta', () => {
  const signal = () => new AbortController().signal;

  it('206: dims from the prefix, size from Content-Range total', async () => {
    const meta = await probeMeta('https://cdn.test/a.png', {
      signal: signal(),
      fetchImpl: async (_i, init) => {
        expect(new Headers(init?.headers).get('range')).toBe(`bytes=0-${PROBE_RANGE_BYTES - 1}`);
        return new Response(new Blob([png(800, 600) as unknown as BlobPart]).stream(), {
          status: 206,
          headers: { 'content-range': `bytes 0-4095/123456`, 'content-length': '4096' },
        });
      },
    });
    expect(meta).toEqual({ dims: { w: 800, h: 600 }, size: 123456 });
  });

  it('range-ignored 200: dims from prefix, size from Content-Length, stream CANCELLED', async () => {
    let cancelled = false;
    let pulls = 0;
    const big = new ReadableStream({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(png(320, 240));
        else controller.enqueue(new Uint8Array(PROBE_RANGE_BYTES).fill(9));
      },
      cancel() {
        cancelled = true;
      },
    });
    const meta = await probeMeta('https://cdn.test/big.png', {
      signal: signal(),
      fetchImpl: async () =>
        new Response(big, { status: 200, headers: { 'content-length': '52428800' } }),
    });
    expect(meta).toEqual({ dims: { w: 320, h: 240 }, size: 52428800 });
    expect(cancelled).toBe(true); // the transfer actually stops
    expect(pulls).toBeLessThan(5);
  });

  it('non-2xx is failed on both axes', async () => {
    const meta = await probeMeta('https://cdn.test/x.png', {
      signal: signal(),
      fetchImpl: async () => new Response('no', { status: 502 }),
    });
    expect(meta).toEqual({ dims: 'failed', size: 'failed' });
  });

  it('timeout is a failed result; caller abort is canceled', async () => {
    const hang = (_i: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      });
    const timedOut = await probeMeta('https://cdn.test/t.png', {
      signal: signal(),
      timeoutMs: 30,
      fetchImpl: hang as typeof fetch,
    });
    expect(timedOut).toEqual({ dims: 'failed', size: 'failed' });
    const controller = new AbortController();
    const pending = probeMeta('https://cdn.test/c.png', {
      signal: controller.signal,
      timeoutMs: 5000,
      fetchImpl: hang as typeof fetch,
    });
    controller.abort();
    expect(await pending).toBe('canceled');
  });
});
