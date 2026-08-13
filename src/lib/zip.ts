import { downloadZip } from 'client-zip';
import type { ScanImage } from './extract';
import { createFetchQueue } from './fetch-queue';
import { PROBE_CONCURRENCY, canProxyFallback, proxyUrl } from './results-model';

/**
 * Client-side ZIP assembly (Phase 3 step 4). The browser fetches each member
 * through /api/proxy and streams it into the archive locally — each Worker
 * invocation stays at one subrequest, per the architecture. Members prefetch
 * through the bounded queue; a queue slot (and its byte weight) is held until
 * the member is WRITTEN into the archive, so the in-flight accounting covers
 * fetched-but-unwritten blobs, not just open streams.
 */

// Per-ZIP member cap. NOT a memory bound (the byte budget below governs
// memory) and not a time bound (Cancel exists) — it is coherence with the
// abuse-control budget: the Phase 4 allowance is 1,000 proxy calls/hour/IP
// (decided 2026-08-10, DECISIONS.md), and a ZIP larger than the remaining
// allowance is an archive designed to fail once limits are live. HALF the
// allowance, not all of it, because a full-budget ZIP leaves nothing for a
// retry, and the ZIP is not the user's only proxy spend — fallback
// thumbnails and Range probes draw from the same pool. The measured
// thorough session (~350 probes + fallbacks) plus a maximal 500-member ZIP
// lands at ~865 of 1,000: it completes, once, with a tail for
// user-initiated retries. Pinned at half the allowance and moves with it —
// unlike MEASURE_WARN_AT, which deliberately does not.
export const MAX_ZIP_IMAGES = 500;

// Concurrent-transfer byte budget. Working (recorded, not just chosen):
// mid-range Android ≈ 4 GB device RAM, tab realistically killable beyond
// ~500 MB; the page's standing cost at ZIP time (DOM + JS + decoded
// thumbnails for ~120-220 mounted tiles) ≈ 200 MB; concurrent transport
// buffering gets ~a quarter of the remaining ~300 MB → 64 MB, just above the
// 50 MB single-file announced cap so the queue's always-admit-one rule
// covers the largest legal member with no special case.
// ASSUMPTION, load-bearing and STILL UNVERIFIED: the accumulating Blob
// archive itself is DISK-BACKED on target browsers (Chromium pages blob
// storage out to disk). If a browser holds it in memory, a 300 MB selection
// is 300 MB resident and this bound does NOT protect against it — that is
// the OOM path, not a side detail.
//
// The mid-range-device pass RAN (2026-08-13, real Android phone, live https
// site) and came back INCONCLUSIVE for this specific assumption, which is
// worth more written down than a tick would have been. A large selection
// zipped and downloaded successfully, and the archive was 10 MB. Against
// this comment's own working — a tab killable beyond ~500 MB — 10 MB is
// about 2% of the threshold, so it completes identically whether the Blob
// spilled to disk or sat entirely in RAM. It cannot tell the two apart.
//
// What the run DID establish: the whole path works on real mobile hardware.
// What would settle this: one archive of a few hundred MB on a phone. Until
// then the risk stands as written — worst case a lost download and a tab
// reload, not data loss.
export const MAX_ZIP_BYTES_IN_FLIGHT = 64_000_000;

// Admission weight for members with no known size (unprobed select-all
// members, and probes that settled 'unknown-length'/'failed'). Sits between
// typical web-image weight (overwhelmingly < 5 MB) and the proxy's 20 MB
// unannounced-body abort; 64/16 gives blind ZIPs 4-way concurrency. The
// blind guess is corrected via queue.setWeight the moment response headers
// arrive, so an overshoot lasts at most one scheduling round.
export const ZIP_UNKNOWN_WEIGHT = 16_000_000;

export interface ZipSkip {
  filename: string;
  url: string;
  reason: string;
}

export interface ZipStats {
  requested: number;
  written: number;
  skipped: ZipSkip[];
  canceled: boolean;
}

interface Fetched {
  blob?: Blob;
  skip?: string;
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// data: members never touch the network — decode locally, exact bytes.
function dataUriToBlob(url: string): Blob {
  const comma = url.indexOf(',');
  const header = url.slice(0, comma === -1 ? url.length : comma);
  const payload = comma === -1 ? '' : url.slice(comma + 1);
  const mime = header.slice(5).split(';')[0] || 'application/octet-stream';
  if (/;base64$/i.test(header)) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  let text: string;
  try {
    text = decodeURIComponent(payload);
  } catch {
    text = payload;
  }
  return new Blob([new TextEncoder().encode(text)], { type: mime });
}

// The skip report ships INSIDE the archive so the person who opens it next
// week sees what is missing without ever having seen our UI. The name dodges
// collisions with manifest members (which are already scan-unique).
function skippedReportName(used: ReadonlySet<string>): string {
  let name = 'SKIPPED.txt';
  for (let n = 2; used.has(name); n += 1) name = `SKIPPED-${n}.txt`;
  return name;
}

/**
 * Assemble a ZIP of the given images. Returns the archive as a streaming
 * Response (pipe it to a FileSystemWritableFileStream, or await .blob())
 * plus a stats promise that settles when the stream completes. Failures are
 * skipped and reported (UI counts + SKIPPED.txt), never fatal; aborting the
 * signal cancels remaining fetches and ends the archive early.
 *
 * NOTE: the stats promise only settles if the Response body is consumed —
 * the member generator runs on demand as the stream is pulled.
 */
export function assembleZip(
  images: readonly ScanImage[],
  options: {
    weightOf: (img: ScanImage) => number;
    signal: AbortSignal;
    onProgress?: (done: number, failed: number, total: number) => void;
    fetchImpl?: typeof fetch;
  },
): { response: Response; stats: Promise<ZipStats> } {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { signal } = options;
  const total = images.length;
  const queue = createFetchQueue({
    maxConcurrent: PROBE_CONCURRENCY,
    maxBytesInFlight: MAX_ZIP_BYTES_IN_FLIGHT,
  });
  const fetched = images.map(() => deferred<Fetched>());
  const written = images.map(() => deferred<void>());
  const aborted = new Promise<void>((res) => {
    if (signal.aborted) res();
    else signal.addEventListener('abort', () => res(), { once: true });
  });
  void aborted.then(() => queue.cancelAll());

  images.forEach((img, i) => {
    void queue.enqueue(img.id, options.weightOf(img), async (taskSignal) => {
      try {
        let blob: Blob;
        if (!canProxyFallback(img)) {
          blob = dataUriToBlob(img.url);
        } else {
          const response = await fetchImpl(proxyUrl(img.url), { signal: taskSignal });
          if (!response.ok) {
            // 429 gets its own token, not http-429: it is the one skip the
            // user can act on (wait for the reset), and the SKIPPED.txt
            // footer explains it. Kept as terse as http-502 so the reason
            // column stays scannable.
            fetched[i]!.resolve({
              skip: response.status === 429 ? 'rate-limit' : `http-${response.status}`,
            });
            return;
          }
          const announced = response.headers.get('content-length');
          if (announced !== null) {
            const bytes = Number(announced);
            if (Number.isFinite(bytes) && bytes >= 0) queue.setWeight(img.id, bytes);
          }
          // A proxy mid-stream abort ERRORS the body (the truncation
          // contract) and lands in the catch — a truncated member is
          // skipped, never silently short inside the archive.
          blob = await response.blob();
        }
        fetched[i]!.resolve({ blob });
        // Hold the slot (and weight) until the member is written into the
        // archive — this is what makes the byte budget cover residency, not
        // just open streams.
        await Promise.race([written[i]!.promise, aborted]);
      } catch {
        fetched[i]!.resolve({ skip: taskSignal.aborted ? 'canceled' : 'truncated' });
      }
    });
  });

  const statsDeferred = deferred<ZipStats>();
  const skipped: ZipSkip[] = [];
  let done = 0;
  let failed = 0;

  async function* members(): AsyncGenerator<{ name: string; input: Blob }> {
    const usedNames = new Set(images.map((img) => img.filename));
    for (let i = 0; i < images.length; i += 1) {
      if (signal.aborted) break;
      const result = await fetched[i]!.promise;
      const img = images[i]!;
      if (result.blob !== undefined && !signal.aborted) {
        yield { name: img.filename, input: result.blob };
        written[i]!.resolve();
        done += 1;
      } else if (result.skip !== undefined && result.skip !== 'canceled') {
        skipped.push({ filename: img.filename, url: img.url, reason: result.skip });
        failed += 1;
      }
      options.onProgress?.(done, failed, total);
    }
    if (!signal.aborted && skipped.length > 0) {
      const report = skipped.map((s) => `${s.filename}\t${s.reason}\t${s.url}`).join('\n');
      // Footers explain the reason codes a reader cannot safely infer — in
      // BOTH directions, which is why none of these may be stripped as
      // noise. rate-limit is the one ACTIONABLE skip (wait, then retry).
      // http-415 is here for the opposite reason: it is not a failure at
      // all — fonts and stylesheets in the manifest are expected — and
      // without the line, "120 of 159" on a font-heavy page reads as a 25%
      // failure rate when nothing went wrong. http-403 lands in BULK when
      // a site refuses proxied downloads wholesale, and bulk needs an
      // explanation where a one-off would not. "truncated" would otherwise
      // read as if a cut-short file were INSIDE the archive, when the
      // contract is the opposite. A one-off http-502 explains itself and
      // deliberately gets no line.
      const FOOTNOTES: ReadonlyArray<[reason: string, note: (n: number) => string]> = [
        [
          'rate-limit',
          (n) =>
            `rate-limit: the hourly image allowance was reached — ${n === 1 ? 'this image is' : `these ${n} images are`} retryable after the limit resets (within the hour).`,
        ],
        [
          'http-415',
          () =>
            "http-415: these URLs served something that isn't an image (fonts, stylesheets) — the proxy passes image types only. Nothing was lost.",
        ],
        [
          'http-403',
          () =>
            "http-403: the site's server refused these requests — some sites block downloads that don't come from their own pages.",
        ],
        [
          'truncated',
          () =>
            'truncated: these transfers ended early or exceeded the size limit — partial files are never written into the archive, so these members were dropped whole.',
        ],
      ];
      const counts = new Map<string, number>();
      for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
      const notes = FOOTNOTES.filter(([reason]) => counts.has(reason)).map(([reason, note]) =>
        note(counts.get(reason) ?? 0),
      );
      const footer = notes.length > 0 ? `\n${notes.join('\n')}\n` : '';
      yield {
        name: skippedReportName(usedNames),
        input: new Blob([`skipped ${skipped.length} of ${total}\n\n${report}\n${footer}`], {
          type: 'text/plain',
        }),
      };
    }
    statsDeferred.resolve({ requested: total, written: done, skipped, canceled: signal.aborted });
  }

  return { response: downloadZip(members()), stats: statsDeferred.promise };
}
