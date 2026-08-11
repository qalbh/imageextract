/**
 * The /api/scan orchestrator: guard → robots.txt → page → stylesheets →
 * manifest. All network goes through safeFetch (full SSRF guard per hop),
 * and the whole scan shares one wall-clock budget rather than each fetch
 * getting its own.
 */

import {
  BlockedHostError,
  TimeoutError,
  safeFetch,
  validateTargetUrl,
} from './ssrf-guard';
import { isPathAllowed, parseRobotsGroups } from './robots';
import type { BlocklistKv } from './blocklist';
import {
  extractCssUrls,
  extractFromHtml,
  finalizeManifest,
  resolveDocumentBase,
  type RawCandidate,
  type ScanResult,
} from './extract';

export const SCAN_TIMEOUT_MS = 10_000;
// Mozilla/5.0 (compatible; ...) is the convention for legitimate
// non-browser agents, and this is a USER-DIRECTED fetch — one page a
// person pasted, no crawling, no schedule — not a crawler, so the string
// reads that way (DECISIONS.md "The User-Agent presents as a
// user-directed fetch"). The two constants MOVE TOGETHER: robots matching
// keys on UA_TOKEN, not on parsing USER_AGENT, so renaming one without
// the other silently stops honouring name-specific robots rules
// (test-pinned through scanPage).
export const USER_AGENT = 'Mozilla/5.0 (compatible; ImageExtract/1.0; +https://imageextract.pics/traffic)';
export const UA_TOKEN = 'imageextract';

const MAX_ROBOTS_BYTES = 102_400;
const MAX_HTML_BYTES = 5_242_880;
const MAX_STYLESHEET_BYTES = 1_048_576;

export interface ScanDeps {
  fetchImpl?: typeof fetch;
  dohFetchImpl?: typeof fetch;
  dohCheck?: boolean;
  timeoutMs?: number;
  /** Operator blocklist KV binding, passed through to every safeFetch. */
  blocklist?: BlocklistKv | null;
}

/**
 * Byte-cap a stream. Truncation closes the reader side cleanly and cancels
 * the upstream, so a multi-hundred-MB page costs at most `maxBytes` of
 * transfer. `hit()` is meaningful once the capped stream has been drained.
 */
function capStream(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): { stream: ReadableStream<Uint8Array> | string; hit: () => boolean } {
  if (body === null) return { stream: '', hit: () => false };
  let count = 0;
  let hit = false;
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (hit) return;
      count += chunk.byteLength;
      if (count > maxBytes) {
        hit = true;
        controller.enqueue(chunk.subarray(0, chunk.byteLength - (count - maxBytes)));
        controller.terminate();
      } else {
        controller.enqueue(chunk);
      }
    },
  });
  // terminate() aborts the writable side, which cancels the upstream body;
  // that rejection is expected, not an error.
  body.pipeTo(transform.writable).catch(() => {});
  return { stream: transform.readable, hit: () => hit };
}

async function readTextCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; hit: boolean }> {
  const capped = capStream(response.body, maxBytes);
  if (typeof capped.stream === 'string') return { text: '', hit: false };
  const text = await new Response(capped.stream).text();
  return { text, hit: capped.hit() };
}

export async function scanPage(rawUrl: string, deps: ScanDeps = {}): Promise<ScanResult> {
  const verdict = validateTargetUrl(rawUrl);
  if (!verdict.ok) throw new BlockedHostError(verdict.reason, verdict.detail);
  const pageUrl = verdict.url;

  const timeoutMs = deps.timeoutMs ?? SCAN_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const remaining = (): number => {
    const left = deadline - Date.now();
    if (left <= 0) throw new TimeoutError(timeoutMs);
    return left;
  };
  const fetchOpts = {
    dohCheck: deps.dohCheck,
    fetchImpl: deps.fetchImpl,
    dohFetchImpl: deps.dohFetchImpl,
    blocklist: deps.blocklist,
  };

  // robots.txt — an unreachable or non-2xx robots file means "no rules",
  // per common crawler practice. A robots block has no override path.
  const robotsResponse = await safeFetch(`${pageUrl.origin}/robots.txt`, {
    ...fetchOpts,
    timeoutMs: remaining(),
    init: { headers: { 'user-agent': USER_AGENT, accept: 'text/plain' } },
  });
  if (robotsResponse.ok) {
    const robots = await readTextCapped(robotsResponse, MAX_ROBOTS_BYTES);
    // If the cap cut mid-line, drop the partial tail line.
    const robotsText = robots.hit
      ? robots.text.slice(0, robots.text.lastIndexOf('\n') + 1)
      : robots.text;
    const rules = parseRobotsGroups(robotsText, UA_TOKEN);
    if (!isPathAllowed(rules, pageUrl.pathname + pageUrl.search)) {
      return { pageUrl: pageUrl.href, images: [], robotsBlocked: true };
    }
  } else {
    await robotsResponse.body?.cancel();
  }

  // The page itself. Non-2xx responses are still parsed: a 404 page is what
  // a human sees at that URL, and its images are real.
  const pageResponse = await safeFetch(pageUrl.href, {
    ...fetchOpts,
    timeoutMs: remaining(),
    init: {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      },
    },
  });
  const cappedHtml = capStream(pageResponse.body, MAX_HTML_BYTES);
  const extraction = await extractFromHtml(
    typeof cappedHtml.stream === 'string' ? '' : cappedHtml.stream,
  );

  // Linked stylesheets (≤3, enforced at collection). Each is guarded and
  // budgeted like any other fetch; a failing sheet degrades the manifest
  // instead of failing the scan, but a blown deadline stops the loop.
  const documentBase = resolveDocumentBase(extraction.baseHref, pageUrl);
  const candidates: RawCandidate[] = [...extraction.candidates];
  for (const href of extraction.stylesheetHrefs) {
    let sheetUrl: URL;
    try {
      sheetUrl = new URL(href, documentBase);
    } catch {
      continue;
    }
    if (!validateTargetUrl(sheetUrl.href).ok) continue;
    try {
      const sheetResponse = await safeFetch(sheetUrl.href, {
        ...fetchOpts,
        timeoutMs: remaining(),
        init: { headers: { 'user-agent': USER_AGENT, accept: 'text/css,*/*;q=0.1' } },
      });
      if (!sheetResponse.ok) {
        await sheetResponse.body?.cancel();
        continue;
      }
      // CSS URLs resolve against the sheet's own (post-redirect) URL, not
      // the page's.
      const sheetBase = sheetResponse.url !== '' ? new URL(sheetResponse.url) : sheetUrl;
      const css = await readTextCapped(sheetResponse, MAX_STYLESHEET_BYTES);
      for (const cssUrl of extractCssUrls(css.text)) {
        try {
          candidates.push({ raw: new URL(cssUrl, sheetBase).href, source: 'stylesheet' });
        } catch {
          // unparseable url() value — skip
        }
      }
    } catch (err) {
      if (err instanceof TimeoutError) break;
      // Blocked or unreachable stylesheet: skip it, keep the scan.
    }
  }

  const { images, truncated } = finalizeManifest({
    pageUrl,
    baseHref: extraction.baseHref,
    candidates,
    sizeCapHit: cappedHtml.hit(),
    volumeCapHit: extraction.hitRawCap,
  });
  return { pageUrl: pageUrl.href, images, ...(truncated !== undefined && { truncated }) };
}
