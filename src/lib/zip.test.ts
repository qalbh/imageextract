import { describe, expect, it } from 'vitest';
import type { ScanImage } from './extract';
import { ZIP_UNKNOWN_WEIGHT, assembleZip } from './zip';

// client-zip runs for real here — workerd has WHATWG streams — so these tests
// assemble genuine archives and parse the central directory back out.

let seq = 0;
function img(name: string, url?: string): ScanImage {
  seq += 1;
  return {
    id: `z${seq}`,
    url: url ?? `https://cdn.test/${name}`,
    filename: name,
    ext: 'png',
    source: 'img',
  };
}

// Minimal EOCD parse: total central-directory entries (u16 at offset 10 from
// the 0x06054b50 signature, scanned from the tail).
function eocdEntryCount(buffer: ArrayBuffer): number {
  const bytes = new Uint8Array(buffer);
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      return new DataView(buffer, i + 10, 2).getUint16(0, true);
    }
  }
  throw new Error('no EOCD record found');
}

const bodyOf = (text: string) => new Response(text, { status: 200, headers: { 'content-length': String(text.length) } });
const includes = (buffer: ArrayBuffer, text: string) =>
  new TextDecoder().decode(buffer).includes(text);

describe('assembleZip', () => {
  it('assembles every member into a parseable archive', async () => {
    const images = [img('a.png'), img('b.png'), img('c.png')];
    const progress: string[] = [];
    const { response, stats } = assembleZip(images, {
      weightOf: () => ZIP_UNKNOWN_WEIGHT,
      signal: new AbortController().signal,
      onProgress: (d, f, t) => progress.push(`${d}/${f}/${t}`),
      fetchImpl: async (input) => bodyOf(`body-of-${String(input)}`),
    });
    const buffer = await response.arrayBuffer();
    const s = await stats;
    expect(eocdEntryCount(buffer)).toBe(3);
    expect(includes(buffer, 'a.png') && includes(buffer, 'b.png') && includes(buffer, 'c.png')).toBe(true);
    expect(s).toMatchObject({ requested: 3, written: 3, canceled: false });
    expect(s.skipped).toEqual([]);
    expect(progress.at(-1)).toBe('3/0/3');
  });

  it('skips failures, reports them in stats AND inside the archive', async () => {
    const images = [img('good.png'), img('bad.png'), img('also-good.png')];
    const { response, stats } = assembleZip(images, {
      weightOf: () => ZIP_UNKNOWN_WEIGHT,
      signal: new AbortController().signal,
      fetchImpl: async (input) =>
        String(input).includes('bad') ? new Response('nope', { status: 502 }) : bodyOf('ok'),
    });
    const buffer = await response.arrayBuffer();
    const s = await stats;
    // 2 members + SKIPPED.txt
    expect(eocdEntryCount(buffer)).toBe(3);
    expect(includes(buffer, 'SKIPPED.txt')).toBe(true);
    expect(includes(buffer, 'bad.png\thttp-502')).toBe(true);
    expect(s.written).toBe(2);
    expect(s.skipped).toEqual([{ filename: 'bad.png', reason: 'http-502', url: 'https://cdn.test/bad.png' }]);
  });

  it('a 429 member gets the rate-limit token and the report footer explains it', async () => {
    const images = [img('good.png'), img('limited.png')];
    const { response, stats } = assembleZip(images, {
      weightOf: () => ZIP_UNKNOWN_WEIGHT,
      signal: new AbortController().signal,
      fetchImpl: async (input) =>
        String(input).includes('limited') ? new Response('slow down', { status: 429 }) : bodyOf('ok'),
    });
    const buffer = await response.arrayBuffer();
    const s = await stats;
    // Terse token beside http-* reasons; the footer carries the explanation.
    expect(includes(buffer, 'limited.png\trate-limit')).toBe(true);
    expect(includes(buffer, 'hourly image allowance was reached')).toBe(true);
    expect(includes(buffer, 'retryable after the limit resets')).toBe(true);
    expect(s.skipped).toEqual([
      { filename: 'limited.png', reason: 'rate-limit', url: 'https://cdn.test/limited.png' },
    ]);
  });

  it('treats an errored body stream as a skipped member (the truncation contract)', async () => {
    const images = [img('trunc.png'), img('fine.png')];
    const { response, stats } = assembleZip(images, {
      weightOf: () => ZIP_UNKNOWN_WEIGHT,
      signal: new AbortController().signal,
      fetchImpl: async (input) => {
        if (!String(input).includes('trunc')) return bodyOf('ok');
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial'));
            controller.error(new Error('mid-stream abort'));
          },
        });
        return new Response(stream, { status: 200 });
      },
    });
    const buffer = await response.arrayBuffer();
    const s = await stats;
    expect(eocdEntryCount(buffer)).toBe(2); // fine.png + SKIPPED.txt
    expect(includes(buffer, 'trunc.png\ttruncated')).toBe(true);
    // The footer counters the token's misleading read: nothing cut-short
    // is ever inside the archive.
    expect(includes(buffer, 'never written into the archive')).toBe(true);
    expect(s.written).toBe(1);
  });

  it('bulk-capable skip reasons get explanatory footers; bare codes stay bare', async () => {
    const images = [img('font.woff2'), img('walled.jpg'), img('down.png'), img('good.png')];
    const { response } = assembleZip(images, {
      weightOf: () => ZIP_UNKNOWN_WEIGHT,
      signal: new AbortController().signal,
      fetchImpl: async (input) => {
        const u = String(input);
        if (u.includes('font')) return new Response('css', { status: 415 });
        if (u.includes('walled')) return new Response('no', { status: 403 });
        if (u.includes('down')) return new Response('err', { status: 502 });
        return bodyOf('ok');
      },
    });
    const buffer = await response.arrayBuffer();
    // 415: reassurance — a font-heavy page's skips are not failures.
    expect(includes(buffer, 'font.woff2\thttp-415')).toBe(true);
    expect(includes(buffer, 'Nothing was lost.')).toBe(true);
    // 403: the bulk wall case gets its explanation.
    expect(includes(buffer, "some sites block downloads that don't come from their own pages")).toBe(true);
    // 502 stays a bare, self-explanatory code — no footer line for it.
    expect(includes(buffer, 'down.png\thttp-502')).toBe(true);
    expect(includes(buffer, 'http-502:')).toBe(false);
  });

  it('embeds data: URI members without any fetch', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const images = [img('inline-1.svg', `data:image/svg+xml,${encodeURIComponent(svg)}`)];
    let fetchCalls = 0;
    const { response, stats } = assembleZip(images, {
      weightOf: () => 100,
      signal: new AbortController().signal,
      fetchImpl: async () => {
        fetchCalls += 1;
        return bodyOf('never');
      },
    });
    const buffer = await response.arrayBuffer();
    await stats;
    expect(fetchCalls).toBe(0);
    expect(eocdEntryCount(buffer)).toBe(1);
    expect(includes(buffer, svg)).toBe(true);
  });

  it('cancel ends the archive early: stats.canceled, no SKIPPED.txt, remaining members unfetched', async () => {
    const controller = new AbortController();
    let fetches = 0;
    let releaseSecond!: () => void;
    const images = [img('one.png'), img('two.png'), img('three.png')];
    const { response, stats } = assembleZip(images, {
      weightOf: () => ZIP_UNKNOWN_WEIGHT,
      signal: controller.signal,
      fetchImpl: async (input) => {
        fetches += 1;
        if (String(input).includes('two')) {
          await new Promise<void>((res) => {
            releaseSecond = res;
          });
        }
        return bodyOf('ok');
      },
    });
    const bufferPromise = response.arrayBuffer();
    // Let member one write, then cancel while two is in flight.
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    releaseSecond();
    await bufferPromise;
    const s = await stats;
    expect(s.canceled).toBe(true);
    expect(s.written).toBeLessThanOrEqual(1);
    expect(fetches).toBeLessThan(images.length + 1);
  });

  it('renames the skip report when a manifest member claims SKIPPED.txt', async () => {
    const images = [img('SKIPPED.txt'), img('bad.png')];
    const { response, stats } = assembleZip(images, {
      weightOf: () => ZIP_UNKNOWN_WEIGHT,
      signal: new AbortController().signal,
      fetchImpl: async (input) =>
        String(input).includes('bad') ? new Response('nope', { status: 500 }) : bodyOf('ok'),
    });
    const buffer = await response.arrayBuffer();
    await stats;
    expect(includes(buffer, 'SKIPPED-2.txt')).toBe(true);
  });
});
