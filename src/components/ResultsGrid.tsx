import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImageExt, ScanImage, ScanResult } from '../lib/extract';
import {
  TILE_REVEAL_CAP,
  applyFilters,
  canonicalFormats,
  formatAllCount,
  formatCounts,
  groupCounts,
  PROBE_AUTO_LIMIT,
  PROBE_CONCURRENCY,
  canProxyFallback,
  dataUriBytes,
  invertWithin,
  METRIC_SORTS,
  dimsKnownCounts,
  parseFormatParam,
  parseSourceParam,
  collapseVariants,
  singleTiles,
  sortTiles,
  tileSelectionState,
  variantUnitOf,
  selectAll,
  selectRange,
  selectedUrls,
  sizeSummary,
  sortImages,
  toggleId,
  type FilterState,
  type KnownDims,
  type SizeEntry,
  type SortDirection,
  type SortKey,
  type SourceGroupId,
} from '../lib/results-model';
import { createFetchQueue } from '../lib/fetch-queue';
import { dataUriDims, probeMeta, type ProbedDims } from '../lib/image-dimensions';
import { ZIP_UNKNOWN_WEIGHT, assembleZip } from '../lib/zip';
import ImageCard from './ImageCard';
import ResultsSidebar from './ResultsSidebar';
import SelectionBar from './SelectionBar';

/**
 * The page's only island. The URL form is static HTML that submits ?url=
 * via native browser behavior; this component reads the param on mount and
 * runs the scan, so the input works with zero JavaScript and every scan has
 * a shareable URL. It also owns all results-view interaction state and renders
 * the sidebar / grid / selection bar over the pure model in lib/results-model.
 */

type ViewState =
  | { kind: 'idle' }
  | { kind: 'loading'; hostname: string }
  | { kind: 'error'; code: string; heading: string; message: string; retry: boolean }
  | { kind: 'robots-blocked' }
  | { kind: 'empty' }
  | { kind: 'results'; result: ScanResult };

const ERRORS: Record<string, { heading: string; retry: boolean }> = {
  'invalid-request': { heading: "That doesn't look like a URL", retry: false },
  'invalid-url': { heading: "That doesn't look like a URL", retry: false },
  'bad-scheme': { heading: 'Only http and https pages can be scanned', retry: false },
  'bad-port': { heading: "Pages on non-standard ports can't be scanned", retry: false },
  'private-ip': { heading: "That address isn't scannable", retry: false },
  'blocked-hostname': { heading: "That address isn't scannable", retry: false },
  'dns-private': { heading: "That address isn't scannable", retry: false },
  'domain-blocked': { heading: 'This site is excluded', retry: false },
  'dns-nxdomain': { heading: 'Domain not found', retry: false },
  'dns-error': { heading: "DNS didn't answer", retry: true },
  'too-many-redirects': { heading: 'Too many redirects', retry: false },
  timeout: { heading: 'The site took too long to respond', retry: true },
  'upstream-network': { heading: "The site couldn't be reached", retry: true },
  // No retry button: it would fail for up to an hour; the message carries
  // the reset time instead.
  'rate-limited': { heading: 'The hourly scan limit was reached', retry: false },
};

// Stable empty manifest so the derived memos keep referential stability while
// the view is in a non-results state.
const NO_IMAGES: ScanImage[] = [];

async function runScan(url: string): Promise<ViewState> {
  let response: Response;
  try {
    response = await fetch(`/api/scan?url=${encodeURIComponent(url)}`);
  } catch {
    return {
      kind: 'error',
      code: 'network',
      heading: 'The scan request failed to send',
      message: 'Check your connection and try again.',
      retry: true,
    };
  }
  if (!response.ok) {
    let code = `http-${response.status}`;
    let message = `The scan failed with HTTP ${response.status}.`;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      if (body.error) code = body.error;
      if (body.message) message = body.message;
    } catch {
      // Non-JSON error body (e.g. a raw 500) — keep the status-based text.
    }
    const known = ERRORS[code];
    return {
      kind: 'error',
      code,
      heading: known?.heading ?? `The scan failed (HTTP ${response.status})`,
      message,
      retry: known?.retry ?? false,
    };
  }
  const result = (await response.json()) as ScanResult;
  if (result.robotsBlocked === true) return { kind: 'robots-blocked' };
  if (result.images.length === 0) return { kind: 'empty' };
  return { kind: 'results', result };
}

function TruncatedBanner({ reason }: { reason: 'image-cap' | 'size-cap' }) {
  // The two reasons demand different advice: image-cap means everything was
  // seen and the list was trimmed; size-cap means part of the page was never
  // parsed at all. The image-cap copy must NOT state a tile count: the cap
  // counts logical images and every size variant of an admitted image is
  // kept, so the grid can legitimately show more than 1,000 tiles.
  return (
    <p className="mb-sm rounded-md border border-warning-border bg-warning-bg px-sm py-xs text-small text-warning-text">
      {reason === 'image-cap'
        ? 'The whole page was scanned, but it has more than 1,000 images — only the first 1,000 are listed (with all their size variants).'
        : 'This page was too large to read completely, so some images may be missing entirely. Scanning a more specific page on the same site may find more.'}
    </p>
  );
}

export default function ResultsGrid() {
  const [state, setState] = useState<ViewState>({ kind: 'idle' });

  // --- results-view interaction state (hooks run unconditionally, per the
  // rules of hooks; they operate over an empty manifest until a scan lands) ---
  // The filename/URL search control was removed (2026-08-10); the model keeps
  // `query` in FilterState, so the island passes a constant ''.
  const [formats, setFormats] = useState<ReadonlySet<ImageExt>>(() => new Set());
  const [groups, setGroups] = useState<ReadonlySet<SourceGroupId>>(() => new Set());
  // Variant collapse: ON by default. One tile per logical image is right for
  // almost everyone; someone hunting a specific breakpoint turns it off in
  // DISPLAY. `expanded` holds the variant-group ids opened in place.
  const [collapse, setCollapse] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [sortKey, setSortKey] = useState<SortKey>('document');
  const [sortDir, setSortDir] = useState<SortDirection>('largest');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [measured, setMeasured] = useState<ReadonlyMap<string, { w: number; h: number }>>(
    () => new Map(),
  );
  // Thumbnail fallback status per image id — parent-owned because tiles
  // unmount on filter changes and local state would retry dead URLs on every
  // filter round trip. Transitions are monotonic (absent → 'proxy' → 'dead',
  // never backwards), which is what enforces retry-once. Lives for the scan:
  // every scan is a navigation, so the island (and this map) resets with it.
  const [fallbacks, setFallbacks] = useState<ReadonlyMap<string, 'proxy' | 'dead'>>(
    () => new Map(),
  );
  // Byte sizes per image id — terminal per scan like fallbacks (resets by
  // navigation). Refs are the authoritative store so probe guards never read
  // a stale render closure; the state copies exist to trigger renders.
  const sizesRef = useRef<Map<string, SizeEntry>>(new Map());
  const pendingSizesRef = useRef<Set<string>>(new Set());
  const [sizes, setSizes] = useState<ReadonlyMap<string, SizeEntry>>(() => new Map());
  const [pendingSizes, setPendingSizes] = useState<ReadonlySet<string>>(() => new Set());
  // Dimension results ride the SAME unified probe (one Range request answers
  // size and dimensions). Successful dims land in `measured` (the map
  // naturalWidth already feeds — chips and sorts need no new plumbing);
  // terminal non-answers ('no-intrinsic', 'failed') are remembered here so
  // nothing re-probes. Refs mirror state for stale-closure-free guards.
  const measuredRef = useRef<Map<string, { w: number; h: number }>>(new Map());
  const dimProbesRef = useRef<Map<string, 'no-intrinsic' | 'failed'>>(new Map());
  const [dimProbes, setDimProbes] = useState<ReadonlyMap<string, 'no-intrinsic' | 'failed'>>(
    () => new Map(),
  );
  // Bumped once when a Measure batch settles: the ONE re-sort the user asked
  // for by clicking Measure. Outside the frozen-sort rule's scope, not an
  // exception to it — that rule exists to stop TRICKLE reordering from
  // measurements nobody requested; an explicit batch is a request for
  // exactly this ordering.
  const [measureEpoch, setMeasureEpoch] = useState(0);
  const [measuring, setMeasuring] = useState(false);
  // The probe queue — the same substrate step 4's GET streams will reuse.
  // Probes weigh 0: only the concurrency bound governs HEADs.
  const probeQueueRef = useRef<ReturnType<typeof createFetchQueue> | null>(null);
  if (probeQueueRef.current === null) {
    probeQueueRef.current = createFetchQueue({ maxConcurrent: PROBE_CONCURRENCY });
  }
  const probeQueue = probeQueueRef.current;
  // ZIP assembly state. One archive at a time; one object URL alive at most
  // (Blob path), revoked on the next tick after the click, on a new ZIP, and
  // on unmount — the AGENTS createObjectURL/revokeObjectURL pairing rule.
  const [zip, setZip] = useState<
    null | {
      phase: 'assembling' | 'done';
      done: number;
      failed: number;
      total: number;
      skipped: number;
      rateLimited?: number;
      // Which write path produced the file — rendered in the completion line
      // so a device/desktop pass can SEE what ran (a 120-member desktop run
      // came back path-ambiguous once; a path nobody can observe is a path
      // nobody verified).
      via?: 'picker' | 'browser';
    }
  >(null);
  const zipAbortRef = useRef<AbortController | null>(null);
  const zipUrlRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      zipAbortRef.current?.abort();
      if (zipUrlRef.current !== null) URL.revokeObjectURL(zipUrlRef.current);
    },
    [],
  );
  const [revealCap, setRevealCap] = useState(TILE_REVEAL_CAP);
  const [invert, setInvert] = useState(false);
  const [copied, setCopied] = useState(false);
  // Copyright notice dismissal — deliberately NOT persisted anywhere: it is
  // reset on every scan (see the scan effect), per the module spec. A
  // permanently dismissed notice on the page where downloads happen would
  // defeat its purpose.
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  // Mobile only: the filter sidebar collapses into a bottom sheet toggled here.
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDialogElement | null>(null);
  // The dialog mounts conditionally; showModal() must run after mount, and
  // is what makes it modal (trap + inert background + Escape + focus
  // restore). A plain open attribute would render it non-modally.
  useEffect(() => {
    if (sheetOpen) sheetRef.current?.showModal();
  }, [sheetOpen]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Anchor for shift-click range selection (the last tile toggled).
  const lastClickedRef = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Pre-applied filters from a /tools/<variant> landing page, so a page that
    // promises "every PNG" delivers a PNG-filtered grid rather than an
    // unfiltered one with instructions. Applied as ordinary filter state: the
    // sidebar renders it ticked and the visitor can untick it.
    //
    // Read in the mount effect rather than a lazy useState initializer
    // deliberately — the island is server-rendered, `window` does not exist
    // there, and seeding filter state during SSR would hydrate a sidebar whose
    // checkboxes disagree with the server's markup. Nothing flashes: the grid
    // is empty until the scan resolves, which is strictly later than this.
    const preFormats = parseFormatParam(params.get('format'));
    const preGroups = parseSourceParam(params.get('source'));
    if (preFormats.size > 0) setFormats(preFormats);
    if (preGroups.size > 0) setGroups(preGroups);
    const url = params.get('url');
    if (!url) return;
    // Prefill the static form input so the address being shown matches the
    // scan being run — the input itself ships no JS, so the island does it.
    const input = document.getElementById('scan-url');
    if (input instanceof HTMLInputElement) input.value = url;
    let hostname = url;
    try {
      hostname = new URL(url).hostname;
    } catch {
      // let the API produce the proper invalid-url error
    }
    setState({ kind: 'loading', hostname });
    setNoticeDismissed(false); // every scan brings the notice back
    void runScan(url).then(setState);
  }, []);

  const images = state.kind === 'results' ? state.result.images : NO_IMAGES;

  // Best-known dimensions: measured (load-time or probed truth) preferred
  // over declared.
  const dimsOf = useCallback(
    (img: ScanImage): KnownDims => measured.get(img.id) ?? { w: img.width, h: img.height },
    [measured],
  );

  const filtered = useMemo(
    () => applyFilters(images, { query: '', formats, groups }),
    [images, formats, groups],
  );

  // Filter runs on ENTRIES, then collapse groups them: a group shows when ANY
  // member passes, represented by the largest PASSING member — so filtering to
  // PNG shows a mixed <picture>'s PNG rather than hiding the picture. The
  // representative is frozen for the render for the same reason the sort is
  // (see below); measureEpoch recomputes it after an explicit Measure batch.
  const tiles = useMemo(
    () => (collapse ? collapseVariants(filtered, dimsOf) : singleTiles(filtered)),
    [filtered, collapse, measureEpoch],
  );

  // Frozen sort: this memo deliberately omits `measured` from its deps.
  // Measured dimensions arriving on image load refresh the badges (they re-run
  // widthOf during render) but must NOT reorder tiles under the pointer.
  // Re-picking a sort (sortKey change) or changing the filter recomputes the
  // order with the newest widths.
  // measureEpoch is the deliberate exception: one bump per settled Measure
  // batch re-sorts with the new dimensions.
  const sortedTiles = useMemo(
    () => sortTiles(tiles, sortKey, sortDir, dimsOf),
    [tiles, sortKey, sortDir, measureEpoch],
  );
  // The representative list. Every downstream consumer — selection, shift
  // ranges, probes, measure candidates — keeps working on ScanImage[] and
  // never learns about grouping: collapse is a view transform, and ids stay
  // real manifest ids, which is what keeps the ZIP and the probe maps intact.
  const sorted = useMemo(() => sortedTiles.map((tile) => tile.image), [sortedTiles]);

  const visibleTiles = useMemo(() => sortedTiles.slice(0, revealCap), [sortedTiles, revealCap]);
  const visible = useMemo(() => visibleTiles.map((tile) => tile.image), [visibleTiles]);

  // Applying a filter resets the reveal window to the first cap of the filtered
  // set (sort reorders the same set, so it keeps the window).
  useEffect(() => {
    setRevealCap(TILE_REVEAL_CAP);
  }, [formats, groups, collapse]);

  // Incremental reveal: append another batch when the sentinel scrolls near.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealCap((cap) => Math.min(cap + TILE_REVEAL_CAP, sortedTiles.length));
        }
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [sortedTiles.length]);

  // Faceted counts — Format honours the active Source filter and vice-versa.
  // The shown format rows are fixed from the full supported set so they never
  // reflow (canonicalFormats).
  const filterState: FilterState = { query: '', formats, groups };
  const formatOrder = useMemo(() => canonicalFormats(), []);
  const fmtCounts = useMemo(() => formatCounts(images, filterState, collapse), [images, groups, collapse]);
  const allFmtCount = useMemo(() => formatAllCount(images, filterState, collapse), [images, groups, collapse]);
  const grpCounts = useMemo(() => groupCounts(images, filterState, collapse), [images, formats, collapse]);
  const dimsCounts = useMemo(() => dimsKnownCounts(sorted, dimsOf), [sorted, dimsOf]);
  // Measure candidates: filtered entries whose ACTIVE metric is unknown and
  // not already terminally probed. naturalWidth measurements from scrolling
  // shrink this live, for free.
  const measureCandidates = useMemo(() => {
    if (!METRIC_SORTS.has(sortKey)) return [] as ScanImage[];
    return sorted.filter((img) => {
      const d = dimsOf(img);
      const unknown =
        sortKey === 'width' ? d.w === undefined
        : sortKey === 'height' ? d.h === undefined
        : d.w === undefined || d.h === undefined;
      return unknown && !dimProbesRef.current.has(img.id) && !pendingSizesRef.current.has(img.id);
    });
  }, [sorted, sortKey, dimsOf, dimProbes, pendingSizes]);

  const onMeasured = useCallback((id: string, w: number, h: number) => {
    measuredRef.current.set(id, { w, h });
    setMeasured(new Map(measuredRef.current));
  }, []);
  // One retry through the proxy for http(s) URLs; data: URIs go straight to
  // 'dead' (the proxy would reject the scheme). 'dead' is terminal, so a
  // double onerror or a remount can never re-trigger a request.
  const onImageError = useCallback((img: ScanImage) => {
    setFallbacks((prev) => {
      const current = prev.get(img.id);
      if (current === 'dead') return prev;
      const next = new Map(prev);
      next.set(img.id, current === undefined && canProxyFallback(img) ? 'proxy' : 'dead');
      return next;
    });
  }, []);
  const onToggleFormat = useCallback(
    (ext: ImageExt) =>
      setFormats((prev) => {
        const next = new Set(prev);
        if (next.has(ext)) next.delete(ext);
        else next.add(ext);
        return next;
      }),
    [],
  );
  const onToggleGroup = useCallback(
    (id: SourceGroupId) =>
      setGroups((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const onToggleExpand = useCallback((unit: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(unit)) next.delete(unit);
      else next.add(unit);
      return next;
    });
  }, []);

  // The note below the grid header appears only while it is TRUE: a collapsed
  // tile standing for several versions is selected, so four other versions
  // exist that the selection does not include. Stating the rule where it
  // applies beats a permanent line nobody reads.
  const collapsedSelectionActive = useMemo(
    () =>
      collapse &&
      sortedTiles.some((tile) => tile.members.length > 1 && tileSelectionState(tile, selected).checked),
    [collapse, sortedTiles, selected],
  );

  // Every count the chrome shows must be in the SAME unit as the grid, or the
  // bar contradicts the tiles it sits under. Caught by looking at the rendered
  // page: "9 images found · Select all (9)" read out over four tiles, and the
  // sort sub-labels put a representative numerator over an entry denominator.
  const totalCount = useMemo(() => {
    if (!collapse) return images.length;
    const units = new Set<string>();
    for (const img of images) units.add(variantUnitOf(img));
    return units.size;
  }, [images, collapse]);

  const imageById = useMemo(() => new Map(images.map((img) => [img.id, img])), [images]);

  const recordDims = useCallback((id: string, dims: ProbedDims) => {
    if (typeof dims === 'object') {
      measuredRef.current.set(id, dims);
      setMeasured(new Map(measuredRef.current));
    } else {
      dimProbesRef.current.set(id, dims);
      setDimProbes(new Map(dimProbesRef.current));
    }
  }, []);

  // Resolve one image's metadata — the UNIFIED probe: one prefix Range
  // through the proxy yields the byte size (Content-Range total, or
  // Content-Length on a range-ignored 200) AND the dimensions (parsed from
  // the file header). A size probe measures dimensions for free and vice
  // versa. data: URIs resolve both locally, zero network. Guards read the
  // refs, never a render closure, so a settled or in-flight id is never
  // re-probed.
  const resolveProbe = useCallback(
    (img: ScanImage | undefined) => {
      if (!img) return;
      const done =
        sizesRef.current.has(img.id) &&
        (measuredRef.current.has(img.id) || dimProbesRef.current.has(img.id));
      if (done || pendingSizesRef.current.has(img.id)) return;
      if (!canProxyFallback(img)) {
        sizesRef.current.set(img.id, dataUriBytes(img.url));
        setSizes(new Map(sizesRef.current));
        recordDims(img.id, dataUriDims(img.url));
        return;
      }
      pendingSizesRef.current.add(img.id);
      setPendingSizes(new Set(pendingSizesRef.current));
      return probeQueue.enqueue(img.id, 0, (signal) => probeMeta(img.url, { signal })).then((result) => {
        pendingSizesRef.current.delete(img.id);
        // 'canceled' (deselection/cancel) caches nothing; a probe that
        // resolved before its cancel landed still caches — the subrequest
        // is spent and the answers are immutable facts.
        if (result !== 'canceled') {
          sizesRef.current.set(img.id, result.size);
          if (!measuredRef.current.has(img.id)) recordDims(img.id, result.dims);
        }
        setPendingSizes(new Set(pendingSizesRef.current));
        setSizes(new Map(sizesRef.current));
      });
    },
    [probeQueue, recordDims],
  );
  const resolveSize = resolveProbe;

  // Whole-tile toggle. Shift-click extends a range from the last-clicked tile
  // across the CURRENT filtered+sorted order; a plain click toggles one.
  // Auto-probing follows the burst rule: a single toggle-on probes its image;
  // a shift-range probes only when the range spans ≤ PROBE_AUTO_LIMIT — a
  // larger range is bulk selection (same class as select-all/invert) and
  // falls to the explicit Calculate-size action.
  const handleTileToggle = (id: string, shift: boolean) => {
    const anchor = lastClickedRef.current;
    if (shift && anchor && anchor !== id) {
      setSelected((prev) => selectRange(prev, sorted, anchor, id));
      const a = sorted.findIndex((img) => img.id === anchor);
      const b = sorted.findIndex((img) => img.id === id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        if (hi - lo + 1 <= PROBE_AUTO_LIMIT) {
          for (let k = lo; k <= hi; k += 1) resolveSize(sorted[k]);
        }
      } else {
        resolveSize(imageById.get(id));
      }
    } else {
      const turningOn = !selected.has(id);
      setSelected((prev) => toggleId(prev, id));
      if (turningOn) resolveSize(imageById.get(id));
      else probeQueue.cancel(id);
    }
    lastClickedRef.current = id;
  };
  // Bulk selection ops never auto-probe (the burst rule); invert and clear
  // cancel in-flight probes for images they deselect.
  const handleSelectAll = () => setSelected((prev) => selectAll(prev, filtered));
  const handleClear = () => {
    probeQueue.cancelAll();
    setSelected(new Set());
  };
  const handleInvert = () => {
    for (const img of filtered) if (selected.has(img.id)) probeQueue.cancel(img.id);
    setSelected((prev) => invertWithin(prev, filtered));
  };
  const handleCalculateSize = () => {
    for (const id of selected) resolveSize(imageById.get(id));
  };
  const handleCancelSizing = () => probeQueue.cancelAll();
  // Measure batch: probe every candidate, then ONE re-sort when the batch
  // settles — the ordering the click asked for.
  const handleMeasure = () => {
    if (measureCandidates.length === 0) return;
    setMeasuring(true);
    const work = measureCandidates.map((img) => resolveProbe(img) ?? Promise.resolve());
    void Promise.all(work).then(() => {
      setMeasuring(false);
      setMeasureEpoch((epoch) => epoch + 1);
    });
  };
  const handleCancelMeasure = () => probeQueue.cancelAll();

  // ZIP assembly. Members in document order over the FULL selection (which
  // survives filters, so hidden-selected images are included). Admission
  // weight: probed/local size when known, the blind default otherwise —
  // corrected inside assembleZip once response headers arrive.
  const handleDownloadZip = async () => {
    const members = images.filter((img) => selected.has(img.id));
    if (members.length === 0 || zip?.phase === 'assembling') return;
    const controller = new AbortController();
    zipAbortRef.current = controller;
    setZip({ phase: 'assembling', done: 0, failed: 0, total: members.length, skipped: 0 });

    // Picker FIRST (needs user activation, and a dismissed picker must cost
    // zero subrequests — assembly hasn't started yet). Desktop Chromium only;
    // everywhere else (all of Android) takes the Blob path.
    let writable: FileSystemWritableFileStream | null = null;
    const hostname = (() => {
      try {
        return new URL(state.kind === 'results' ? state.result.pageUrl : '').hostname.replace(/^www\./, '');
      } catch {
        return 'images';
      }
    })();
    const zipName = `${hostname || 'images'}.zip`;
    try {
      if ('showSaveFilePicker' in window) {
        const picker = (
          window as unknown as {
            showSaveFilePicker: (options: object) => Promise<{ createWritable(): Promise<FileSystemWritableFileStream> }>;
          }
        ).showSaveFilePicker;
        const handle = await picker({
          suggestedName: zipName,
          types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
        });
        writable = await handle.createWritable();
      }
    } catch {
      // Picker dismissed — nothing fetched, nothing to clean up.
      setZip(null);
      return;
    }

    const { response, stats } = assembleZip(members, {
      weightOf: (img) => {
        const known = sizesRef.current.get(img.id);
        if (typeof known === 'number') return known;
        if (!canProxyFallback(img)) return dataUriBytes(img.url);
        return ZIP_UNKNOWN_WEIGHT;
      },
      signal: controller.signal,
      onProgress: (done, failed, total) =>
        setZip({ phase: 'assembling', done, failed, total, skipped: failed }),
    });

    try {
      if (writable !== null) {
        // Streams to disk; per the FileSystemWritableFileStream contract
        // (verified against OPFS) nothing is observable until close() and an
        // abort discards — cancel leaves no partial file.
        await response.body?.pipeTo(writable, { signal: controller.signal });
      } else {
        const blob = await response.blob();
        if (controller.signal.aborted) {
          setZip(null);
          return;
        }
        if (zipUrlRef.current !== null) URL.revokeObjectURL(zipUrlRef.current);
        const url = URL.createObjectURL(blob);
        zipUrlRef.current = url;
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = zipName;
        anchor.click();
        window.setTimeout(() => {
          if (zipUrlRef.current === url) {
            URL.revokeObjectURL(url);
            zipUrlRef.current = null;
          }
        }, 1000);
      }
      const s = await stats;
      setZip(
        s.canceled
          ? null
          : {
              phase: 'done',
              done: s.written,
              failed: s.skipped.length,
              total: s.requested,
              skipped: s.skipped.length,
              // Named in the completion line: 300 silent skips mid-ZIP is
              // exactly the confused-support-message the 429 copy exists
              // to prevent.
              rateLimited: s.skipped.filter((k) => k.reason === 'rate-limit').length,
              via: writable !== null ? 'picker' : 'browser',
            },
      );
    } catch {
      // Canceled mid-pipe (FS path) or stream failure — discard per contract.
      controller.abort();
      setZip(null);
    }
  };
  const handleCancelZip = () => zipAbortRef.current?.abort();
  // A completed summary clears when the selection changes; an active assembly
  // is never cleared from here (Cancel owns that).
  useEffect(() => {
    setZip((current) => (current?.phase === 'done' ? null : current));
  }, [selected]);
  const summary = useMemo(
    () => sizeSummary(selected, sizes, pendingSizes),
    [selected, sizes, pendingSizes],
  );
  // Mobile sheet "Clear" resets the filters (not sort/invert, which aren't
  // filters); the count feeds the Filters trigger label.
  const clearFilters = () => {
    setFormats(new Set());
    setGroups(new Set());
  };
  const activeFilterCount = formats.size + groups.size;
  const handleCopy = () => {
    const text = selectedUrls(images, selected).join('\n');
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {
        // Clipboard denied (permissions / insecure context) — leave the label.
      },
    );
  };

  // Shared by both sidebar mounts — the desktop aside and the mobile sheet —
  // so they stay in sync off the same state. Each adds its own instanceId.
  const sidebarProps = {
    formatOrder,
    formats,
    formatCounts: fmtCounts,
    allCount: allFmtCount,
    onToggleFormat,
    onClearFormats: () => setFormats(new Set()),
    groups,
    groupCounts: grpCounts,
    onToggleGroup,
    sortKey,
    onSort: setSortKey,
    sortDir,
    onSortDir: setSortDir,
    dimsCounts,
    measureCount: measureCandidates.length,
    measuring,
    onMeasure: handleMeasure,
    onCancelMeasure: handleCancelMeasure,
    filteredCount: sortedTiles.length,
    invert,
    onInvert: setInvert,
    collapse,
    onCollapse: setCollapse,
  };

  switch (state.kind) {
    case 'idle':
      // Reached on /results with no ?url= — never leave the page blank.
      return (
        <p className="py-lg text-center text-small text-muted">
          Paste a page URL above and hit Scan — every image on the page shows up here.
        </p>
      );
    case 'loading':
      // Skeleton grid rather than a static line — scanning runs for seconds
      // and a frozen message provokes re-submits. Status text is announced
      // for screen readers; the tiles carry the visible progress.
      return (
        <div>
          <p role="status" className="sr-only">
            Scanning {state.hostname}…
          </p>
          <ul className="results-grid" aria-hidden="true">
            {Array.from({ length: 10 }).map((_, i) => (
              <li key={i} className="skeleton-tile" />
            ))}
          </ul>
        </div>
      );
    case 'error':
      return (
        <div role="alert" className="mx-auto max-w-message py-lg text-center">
          <h2 className="mb-xs font-semibold text-text">{state.heading}</h2>
          <p className="text-small text-muted">{state.message}</p>
          {state.retry && (
            <p className="mt-xs text-small text-muted">This is usually temporary — try again in a moment.</p>
          )}
        </div>
      );
    case 'robots-blocked':
      return (
        <div className="mx-auto max-w-message py-lg text-center">
          <h2 className="mb-xs font-semibold text-text">
            This site has asked automated tools not to access this page.
          </h2>
          <p className="text-small text-muted">We respect that, so there is nothing to show.</p>
        </div>
      );
    case 'empty':
      return (
        <div className="mx-auto max-w-message py-lg text-center">
          <h2 className="mb-xs font-semibold text-text">No images found</h2>
          <p className="text-small text-muted">
            The page was scanned successfully, but nothing on it looks like an image.
          </p>
        </div>
      );
    case 'results':
      return (
        <div>
          {/* Copyright notice — accent alert treatment. Dismissal is state,
              never storage: it comes back on every scan (definition of done). */}
          {!noticeDismissed && (
            <div className="mb-sm flex items-center gap-xs rounded-md bg-notice-bg px-sm py-xs text-small text-accent">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" />
                <path d="M8 7.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="8" cy="5" r="0.75" fill="currentColor" />
              </svg>
              <span className="flex-1">
                Images belong to their creators. Only download what you have the right to use. Nothing
                is stored or logged.
              </span>
              <button
                type="button"
                aria-label="Dismiss notice"
                onClick={() => setNoticeDismissed(true)}
                className="shrink-0 px-xs text-body"
              >
                ×
              </button>
            </div>
          )}
          {state.result.truncated !== undefined && <TruncatedBanner reason={state.result.truncated} />}
          <div className="flex">
            {/* Desktop sidebar: a surface column with a hairline to the grid
                area, which stays on the body's --color-bg. Below the md
                breakpoint the same controls open as a bottom sheet. */}
            <aside
              className="hidden shrink-0 border-r border-border bg-surface p-md md:block"
              style={{ width: 'var(--layout-sidebar)' }}
            >
              <ResultsSidebar instanceId="desktop" {...sidebarProps} />
            </aside>

            <div className="min-w-0 flex-1 md:pl-md">
              <p className="mb-sm text-right font-mono text-label uppercase text-muted">
                Showing {visible.length} of {sorted.length}
              </p>
              {/* Stated, not assumed: a collapsed tile contributes ONE image.
                  Lives here rather than in the selection bar because the
                  mobile bar's height is load-bearing — the filter sheet's
                  max-height derives from it (design-system.md), so a fourth
                  row there would move two other things. */}
              {collapsedSelectionActive && (
                <p className="mb-sm text-small text-muted">
                  Collapsed tiles contribute their largest version. Expand a tile to choose a
                  different size.
                </p>
              )}
              {sorted.length === 0 ? (
                <p className="py-lg text-small text-muted">No images match these filters.</p>
              ) : (
                <ul className="results-grid">
                  {visibleTiles.map((tile) => {
                    const unit = variantUnitOf(tile.image);
                    const isOpen = expanded.has(unit);
                    const sel = tileSelectionState(tile, selected);
                    const card = (image: ScanImage, variant: boolean) => (
                      <ImageCard
                        key={image.id}
                        image={image}
                        selected={selected.has(image.id)}
                        invert={invert}
                        fallback={fallbacks.get(image.id)}
                        probedDims={measured.get(image.id)}
                        onToggle={handleTileToggle}
                        onMeasured={onMeasured}
                        onImageError={onImageError}
                        isVariant={variant}
                      />
                    );
                    // Expanded: the group's members take the collapsed tile's
                    // place, in document order, so the set stays where the eye
                    // left it. Members are rendered REGARDLESS of the reveal
                    // cap — a group is a bounded handful and hiding half of an
                    // expansion behind a scroll would be nonsense.
                    if (isOpen) {
                      return tile.members.map((member, i) =>
                        i === 0 ? (
                          <ImageCard
                            key={member.id}
                            image={member}
                            selected={selected.has(member.id)}
                            invert={invert}
                            fallback={fallbacks.get(member.id)}
                            probedDims={measured.get(member.id)}
                            onToggle={handleTileToggle}
                            onMeasured={onMeasured}
                            onImageError={onImageError}
                            variantCount={tile.members.length}
                            selectedCount={sel.selectedCount}
                            expanded
                            onToggleExpand={onToggleExpand}
                            isVariant
                          />
                        ) : (
                          card(member, true)
                        ),
                      );
                    }
                    return (
                      <ImageCard
                        key={tile.image.id}
                        image={tile.image}
                        selected={sel.checked}
                        partial={sel.partial}
                        invert={invert}
                        fallback={fallbacks.get(tile.image.id)}
                        probedDims={measured.get(tile.image.id)}
                        onToggle={handleTileToggle}
                        onMeasured={onMeasured}
                        onImageError={onImageError}
                        variantCount={tile.members.length}
                        selectedCount={sel.selectedCount}
                        expanded={false}
                        onToggleExpand={onToggleExpand}
                      />
                    );
                  })}
                </ul>
              )}
              {revealCap < sortedTiles.length && <div ref={sentinelRef} aria-hidden="true" />}
            </div>
          </div>

          {/* Bottom chrome: the selection bar. On mobile it is two rows and
              carries the Filters trigger; on desktop a single row. Sticky so it
              pins to the viewport bottom while the grid scrolls. */}
          <div className="sticky bottom-0 z-30 mt-md">
            <SelectionBar
              total={totalCount}
              selectedCount={selected.size}
              filteredCount={sortedTiles.length}
              copied={copied}
              activeFilterCount={activeFilterCount}
              filtersOpen={sheetOpen}
              summary={summary}
              zip={zip}
              onOpenFilters={() => setSheetOpen(true)}
              onSelectAll={handleSelectAll}
              onClear={handleClear}
              onInvert={handleInvert}
              onCopy={handleCopy}
              onCalculateSize={handleCalculateSize}
              onCancelSizing={handleCancelSizing}
              onDownloadZip={() => void handleDownloadZip()}
              onCancelZip={handleCancelZip}
            />
          </div>

          {/* Mobile filter sheet — the same ResultsSidebar over a dimming
              scrim, stopping above the bottom bars so the selection bar stays
              visible. Live filters, so Apply just dismisses; Clear resets. */}
          {sheetOpen && (
            <div className="md:hidden">
              {/* Native <dialog> + showModal(): the focus trap, Escape-to-
                  close, page inertness, and focus-restore-to-trigger all
                  come from the platform — the keyboard audit found the
                  hand-rolled version claimed aria-modal while focus walked
                  into the page behind the scrim. role/aria-modal are
                  implicit in a modal dialog; the scrim button is replaced
                  by ::backdrop (click-to-close: a backdrop click targets
                  the dialog element itself). */}
              <dialog
                ref={sheetRef}
                aria-label="Filters"
                className="filter-sheet rounded-md bg-surface"
                onClose={() => setSheetOpen(false)}
                onClick={(event) => {
                  if (event.target === sheetRef.current) sheetRef.current?.close();
                }}
              >
                <div className="min-h-0 flex-1 overflow-y-auto border-t border-border p-md">
                  <ResultsSidebar instanceId="mobile" {...sidebarProps} />
                </div>
                <div className="flex gap-md border-t border-border bg-surface p-md">
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="rounded-md border border-border px-md py-xs font-mono text-label uppercase text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => sheetRef.current?.close()}
                    className="flex-1 rounded-md bg-accent px-md py-xs font-mono text-label uppercase text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Apply
                  </button>
                </div>
              </dialog>
            </div>
          )}
        </div>
      );
  }
}
