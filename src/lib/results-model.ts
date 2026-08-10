import { type ImageExt, type ImageSource, type ScanImage } from './extract';

/**
 * Pure results-view model — every filter/sort/selection/count rule lives here
 * as a DOM-free function so it can be unit-tested in workerd (the test pool has
 * no DOM). The island in ResultsGrid.tsx is a thin renderer over these.
 */

// User-facing source buckets, grouped from the 14 raw IMAGE_SOURCES and ordered
// as they render in the sidebar. Retires the SOURCE_GROUPS doc-sync allowlist
// entry (frontend-plan step 4) — that entry is removed in the same commit.
export const SOURCE_GROUPS = [
  { id: 'page', label: 'Page images', sources: ['img', 'srcset', 'picture', 'lazy'] },
  { id: 'css', label: 'CSS backgrounds', sources: ['style-attr', 'style-block', 'stylesheet'] },
  { id: 'svg', label: 'Inline SVG', sources: ['inline-svg'] },
  { id: 'meta', label: 'Meta & icons', sources: ['meta', 'favicon', 'json-ld'] },
  { id: 'media', label: 'Media & embeds', sources: ['poster', 'object', 'embed'] },
] as const satisfies ReadonlyArray<{ id: string; label: string; sources: readonly ImageSource[] }>;

export type SourceGroupId = (typeof SOURCE_GROUPS)[number]['id'];

// Compile-time exhaustiveness: every ImageSource must belong to exactly one
// bucket. Add a source to IMAGE_SOURCES without placing it in a group above and
// `Exclude<…>` becomes a non-never union, so this alias fails to satisfy the
// `T extends never` constraint and the build breaks. (A runtime test guards the
// "exactly one" half — duplicate membership.)
type GroupedSource = (typeof SOURCE_GROUPS)[number]['sources'][number];
type AssertNever<T extends never> = T;
export type ExhaustiveGroups = AssertNever<Exclude<ImageSource, GroupedSource>>;

// Sources whose images are typically small marks (a 32px favicon, an inline
// SVG icon). The tile well renders these object-contain at natural size —
// object-cover would upscale a tiny raster to fill a ~220px well, which is
// mush. Everything else covers the well.
export const ICON_SOURCES: ReadonlySet<ImageSource> = new Set<ImageSource>(['favicon', 'inline-svg']);

// The proxy URL for one image. Inline display by default; download adds the
// attachment disposition (single-image download, Phase 3 step 2).
export function proxyUrl(url: string, options?: { download?: boolean }): string {
  const qs = `url=${encodeURIComponent(url)}`;
  return options?.download === true ? `/api/proxy?${qs}&download=1` : `/api/proxy?${qs}`;
}

// Whether a failed direct thumbnail is worth one proxy retry. The only test is
// scheme: the proxy fetches http/https, so a data: URI (inline-svg
// serializations, embedded data URIs) would be rejected as bad-scheme — a
// guaranteed-futile subrequest. Deliberately NO heuristic beyond that: the
// browser's onerror carries no status code and the manifest cannot tell a 403
// from a 404 or a dead host, while any ext/source guess would skip REAL
// hotlink cases (stylesheet-sourced images are among the most
// hotlink-protected on the web) to save a call on cases it cannot identify
// anyway. One wasted subrequest per dead URL in the viewport, once per scan,
// is the accepted cost — bounded by lazy loading plus the reveal cap.
export function canProxyFallback(img: ScanImage): boolean {
  return img.url.startsWith('https://') || img.url.startsWith('http://');
}

// Download target for one image. http(s) goes through the proxy for the
// attachment disposition (browsers ignore `download` on cross-origin
// anchors — the reason the proxy exists); data: URIs are exempt from that
// restriction, so the anchor points at the URI itself — no proxy, no
// subrequest, nothing to disable. The anchor's download attribute carries
// the manifest filename: it names data: downloads outright, and for proxy
// downloads the server's Content-Disposition wins per spec — the attribute
// is only the fallback.
export function downloadHref(img: ScanImage): string {
  return canProxyFallback(img) ? proxyUrl(img.url, { download: true }) : img.url;
}

const GROUP_OF: Record<ImageSource, SourceGroupId> = (() => {
  const map = {} as Record<ImageSource, SourceGroupId>;
  for (const group of SOURCE_GROUPS) for (const source of group.sources) map[source] = group.id;
  return map;
})();

export function sourceGroupOf(source: ImageSource): SourceGroupId {
  return GROUP_OF[source];
}

// Stable, exhaustive format order for the sidebar. The FULL supported set is
// always shown — rows for formats missing from the manifest (or zeroed by
// another filter) render disabled and muted, never removed, so the list can't
// reflow under the pointer.
const FORMAT_ORDER: readonly ImageExt[] = [
  'png',
  'jpeg',
  'svg',
  'gif',
  'webp',
  'avif',
  'ico',
  'unknown',
];

export function canonicalFormats(): ImageExt[] {
  return [...FORMAT_ORDER];
}

// Human labels for the format union. 'jpeg' reads JPG; the union's fallback
// member is 'unknown' (there is no 'other'), labelled UNKNOWN.
const FORMAT_LABEL: Partial<Record<ImageExt, string>> = { jpeg: 'JPG', unknown: 'UNKNOWN' };
export function formatLabel(ext: ImageExt): string {
  return FORMAT_LABEL[ext] ?? ext.toUpperCase();
}

// ---------------------------------------------------------------------------
// Filtering — OR within a group, AND across groups. An empty set means "no
// constraint from this group" (all pass), which is why unselected == unfiltered.
// ---------------------------------------------------------------------------
export interface FilterState {
  query: string;
  formats: ReadonlySet<ImageExt>;
  groups: ReadonlySet<SourceGroupId>;
}

export function matchesQuery(img: ScanImage, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return img.filename.toLowerCase().includes(q) || img.url.toLowerCase().includes(q);
}

export function matchesFilters(img: ScanImage, state: FilterState): boolean {
  if (!matchesQuery(img, state.query)) return false;
  if (state.formats.size > 0 && !state.formats.has(img.ext)) return false;
  if (state.groups.size > 0 && !state.groups.has(sourceGroupOf(img.source))) return false;
  return true;
}

export function applyFilters(images: readonly ScanImage[], state: FilterState): ScanImage[] {
  return images.filter((img) => matchesFilters(img, state));
}

// ---------------------------------------------------------------------------
// Faceted counts — each group's counts are computed with that group's own
// selection excluded, so Format counts reflect the active Source (and query)
// filter and vice-versa. This is what "counts update with the filtered set"
// means once two filter groups coexist.
// ---------------------------------------------------------------------------
export function formatCounts(images: readonly ScanImage[], state: FilterState): Map<ImageExt, number> {
  const base: FilterState = { query: state.query, formats: new Set(), groups: state.groups };
  const counts = new Map<ImageExt, number>();
  for (const img of images) {
    if (matchesFilters(img, base)) counts.set(img.ext, (counts.get(img.ext) ?? 0) + 1);
  }
  return counts;
}

// The faceted "All" row: total of the set filtered by everything except the
// format selection.
export function formatAllCount(images: readonly ScanImage[], state: FilterState): number {
  const base: FilterState = { query: state.query, formats: new Set(), groups: state.groups };
  let n = 0;
  for (const img of images) if (matchesFilters(img, base)) n += 1;
  return n;
}

export function groupCounts(
  images: readonly ScanImage[],
  state: FilterState,
): Map<SourceGroupId, number> {
  const base: FilterState = { query: state.query, formats: state.formats, groups: new Set() };
  const counts = new Map<SourceGroupId, number>();
  for (const img of images) {
    if (matchesFilters(img, base)) {
      const group = sourceGroupOf(img.source);
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Sorting. widthOf returns the best-known width (measured preferred over
// declared) or undefined. Callers freeze the sort by recomputing only when the
// key or filtered set changes, not as measurements trickle in.
// ---------------------------------------------------------------------------
// One row per key plus a direction toggle for the metric sorts — not
// Largest/Smallest as separate rows (fewer controls, applied uniformly).
// 'imagesize' is AREA (w×h): "Image size" means dimensions here; FILE size
// (bytes) lives only in the selection bar — "sort by size" is ambiguous and
// the two are deliberately named apart.
export type SortKey = 'document' | 'imagesize' | 'width' | 'height' | 'name' | 'type';
export type SortDirection = 'largest' | 'smallest';
export const METRIC_SORTS: ReadonlySet<SortKey> = new Set(['imagesize', 'width', 'height']);

export const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'document', label: 'Document order' },
  { key: 'imagesize', label: 'Image size' },
  { key: 'width', label: 'Width' },
  { key: 'height', label: 'Height' },
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
];

export interface KnownDims {
  w?: number;
  h?: number;
}

function metricOf(key: SortKey, dims: KnownDims): number | undefined {
  if (key === 'width') return dims.w;
  if (key === 'height') return dims.h;
  if (key === 'imagesize') return dims.w !== undefined && dims.h !== undefined ? dims.w * dims.h : undefined;
  return undefined;
}

export function sortImages(
  images: readonly ScanImage[],
  key: SortKey,
  direction: SortDirection,
  dimsOf: (img: ScanImage) => KnownDims,
): ScanImage[] {
  const arr = images.slice();
  switch (key) {
    case 'document':
      // Input arrives in document order (extractor order, preserved by
      // applyFilters), so identity is the document sort. Direction does not
      // apply to non-metric sorts.
      return arr;
    case 'name':
      return arr.sort((a, b) => a.filename.toLowerCase().localeCompare(b.filename.toLowerCase()));
    case 'type':
      return arr.sort(
        (a, b) =>
          a.ext.localeCompare(b.ext) ||
          a.filename.toLowerCase().localeCompare(b.filename.toLowerCase()),
      );
    case 'imagesize':
    case 'width':
    case 'height':
      return arr.sort((a, b) => {
        const va = metricOf(key, dimsOf(a));
        const vb = metricOf(key, dimsOf(b));
        // Unknowns sort LAST regardless of direction — flipping to
        // smallest-first must not surface the unmeasured pile.
        if (va === undefined && vb === undefined) return 0; // stable: document order
        if (va === undefined) return 1;
        if (vb === undefined) return -1;
        return direction === 'largest' ? vb - va : va - vb;
      });
  }
}

// Known-metric counts for the three dimension sorts' "n of m" sub-labels,
// one pass.
export function dimsKnownCounts(
  images: readonly ScanImage[],
  dimsOf: (img: ScanImage) => KnownDims,
): { width: number; height: number; imagesize: number } {
  let width = 0;
  let height = 0;
  let imagesize = 0;
  for (const img of images) {
    const d = dimsOf(img);
    if (d.w !== undefined) width += 1;
    if (d.h !== undefined) height += 1;
    if (d.w !== undefined && d.h !== undefined) imagesize += 1;
  }
  return { width, height, imagesize };
}

// ---------------------------------------------------------------------------
// Selection — a global Set<id>. Select-all/invert operate on the *filtered*
// set; clear is global; selection survives filter changes because ids hidden by
// a filter are never pruned.
// ---------------------------------------------------------------------------
export function toggleId(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function selectAll(selected: ReadonlySet<string>, filtered: readonly ScanImage[]): Set<string> {
  const next = new Set(selected);
  for (const img of filtered) next.add(img.id);
  return next;
}

export function invertWithin(
  selected: ReadonlySet<string>,
  filtered: readonly ScanImage[],
): Set<string> {
  const next = new Set(selected);
  for (const img of filtered) {
    if (next.has(img.id)) next.delete(img.id);
    else next.add(img.id);
  }
  return next;
}

// Shift-click range: select every tile between the anchor (last-clicked) and
// the target, inclusive, in the CURRENT filtered+sorted order. If the anchor is
// gone (filtered out), fall back to selecting just the target.
export function selectRange(
  selected: ReadonlySet<string>,
  order: readonly ScanImage[],
  anchorId: string,
  targetId: string,
): Set<string> {
  const a = order.findIndex((img) => img.id === anchorId);
  const b = order.findIndex((img) => img.id === targetId);
  const next = new Set(selected);
  if (a === -1 || b === -1) {
    next.add(targetId);
    return next;
  }
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  for (let k = lo; k <= hi; k += 1) next.add(order[k]!.id);
  return next;
}

// URLs of selected images, in document order, for Copy URLs.
export function selectedUrls(
  images: readonly ScanImage[],
  selected: ReadonlySet<string>,
): string[] {
  return images.filter((img) => selected.has(img.id)).map((img) => img.url);
}

// Initial reveal cap — the design-system tile-reveal constant. Intersection
// observer appends another batch of this size on scroll.
export const TILE_REVEAL_CAP = 120;

// ---------------------------------------------------------------------------
// Byte-size probing (Phase 3 step 3). Sizes are cached per scan; probing is
// individually user-initiated — bulk operations never auto-probe (decided
// 2026-08-10; a concurrency cap spreads a burst out, it doesn't prevent one).
// ---------------------------------------------------------------------------

// Aligned with the documented download concurrency cap; the probe queue and
// step 4's GET queue share this shape.
export const PROBE_CONCURRENCY = 6;
// Client-side probe timeout — a third of the proxy's own 30s ceiling. A HEAD
// returns headers only, so even a slow origin answers in a few seconds; 10s
// bounds how long a hung probe can hold a queue slot (six hung probes would
// otherwise freeze the queue for the server's full 30s).
export const PROBE_TIMEOUT_MS = 10_000;
// Shift-range auto-probe threshold. A range is the "what I can see" gesture:
// a screenful is ~12–16 tiles at desktop widths, so 24 covers a generous
// viewport-and-a-bit — at most 4 queue rounds, settled in seconds, never a
// surprising burst. Anything larger is bulk selection, the same class as
// select-all and invert, and falls to the explicit Calculate-size action.
export const PROBE_AUTO_LIMIT = 24;

// Terminal per scan, like the fallback map: no auto-retry, no re-probe.
// 'unknown-length' is a 2xx with no Content-Length (chunked origin — a GET
// would not learn more); 'failed' is any error, timeout included.
export type SizeEntry = number | 'unknown-length' | 'failed';

// The HEAD-based probeSize was RETIRED from the client (2026-08-10): the
// unified Range probe (probeMeta in image-dimensions.ts) answers size AND
// dimensions from the same single subrequest — Content-Range's total after
// the slash is the full byte size. The server's HEAD variant stays for
// external callers; our client just no longer uses it.

// A dimension-measure batch above this count gets an explicit note under
// the button. The rationale is BURST SIZE: past a couple hundred requests,
// authorising a single click on a bare count is no longer informed consent,
// whatever the hourly budget happens to be. At the originally planned
// 500/hr allowance this coincided with ~40% of the budget; the allowance is
// now 1,000/hr (2026-08-10) and the number deliberately did NOT move —
// burst size is the durable rationale, budget share was a coincidence. Do
// not scale this to restore a ratio that was never the point; unlike
// MAX_ZIP_IMAGES, it is not pinned to the allowance.
export const MEASURE_WARN_AT = 200;

// Exact decoded byte size of a data: URI — free, synchronous, no probe needed.
export function dataUriBytes(url: string): number {
  const comma = url.indexOf(',');
  if (comma === -1) return 0;
  const header = url.slice(0, comma);
  const payload = url.slice(comma + 1);
  if (/;base64$/i.test(header)) {
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(payload)).length;
  } catch {
    return new TextEncoder().encode(payload).length;
  }
}

// Decimal units (KB = 1000), NOT binary — the number must match what the
// user's downloads folder and every OS file panel show.
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units: Array<[number, string]> = [
    [1e9, 'GB'],
    [1e6, 'MB'],
    [1e3, 'KB'],
  ];
  for (const [divisor, unit] of units) {
    if (bytes >= divisor) {
      const value = (bytes / divisor).toFixed(1).replace(/\.0$/, '');
      return `${value} ${unit}`;
    }
  }
  return `${bytes} B`;
}

// The selection bar's numbers. `pending` is the island's set of ids with a
// probe in flight. The bar never silently undercounts: every selected member
// is either summed, counted unknown (settled without a size), pending, or
// unprobed (Calculate size covers those).
export function sizeSummary(
  selected: ReadonlySet<string>,
  sizes: ReadonlyMap<string, SizeEntry>,
  pending: ReadonlySet<string>,
): { knownBytes: number; knownCount: number; unknownCount: number; pendingCount: number; unprobedCount: number } {
  let knownBytes = 0;
  let knownCount = 0;
  let unknownCount = 0;
  let pendingCount = 0;
  let unprobedCount = 0;
  for (const id of selected) {
    const entry = sizes.get(id);
    if (typeof entry === 'number') {
      knownBytes += entry;
      knownCount += 1;
    } else if (entry === 'unknown-length' || entry === 'failed') {
      unknownCount += 1;
    } else if (pending.has(id)) {
      pendingCount += 1;
    } else {
      unprobedCount += 1;
    }
  }
  return { knownBytes, knownCount, unknownCount, pendingCount, unprobedCount };
}
