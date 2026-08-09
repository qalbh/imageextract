import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImageExt, ScanImage, ScanResult } from '../lib/extract';
import {
  TILE_REVEAL_CAP,
  applyFilters,
  canonicalFormats,
  formatAllCount,
  formatCounts,
  groupCounts,
  invertWithin,
  knownWidthCount,
  selectAll,
  selectRange,
  selectedUrls,
  sortImages,
  toggleId,
  type FilterState,
  type SortKey,
  type SourceGroupId,
} from '../lib/results-model';
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
  'dns-nxdomain': { heading: 'Domain not found', retry: false },
  'dns-error': { heading: "DNS didn't answer", retry: true },
  'too-many-redirects': { heading: 'Too many redirects', retry: false },
  timeout: { heading: 'The site took too long to respond', retry: true },
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
  // parsed at all.
  return (
    <p className="mb-sm rounded-sm border border-warning-border bg-warning-bg px-sm py-xs text-small text-warning-text">
      {reason === 'image-cap'
        ? 'The whole page was scanned, but it has more than 1,000 images — showing the first 1,000.'
        : 'This page was too large to read completely, so some images may be missing entirely. Scanning a more specific page on the same site may find more.'}
    </p>
  );
}

export default function ResultsGrid() {
  const [state, setState] = useState<ViewState>({ kind: 'idle' });

  // --- results-view interaction state (hooks run unconditionally, per the
  // rules of hooks; they operate over an empty manifest until a scan lands) ---
  const [query, setQuery] = useState('');
  const [formats, setFormats] = useState<ReadonlySet<ImageExt>>(() => new Set());
  const [groups, setGroups] = useState<ReadonlySet<SourceGroupId>>(() => new Set());
  const [sortKey, setSortKey] = useState<SortKey>('document');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [measured, setMeasured] = useState<ReadonlyMap<string, { w: number; h: number }>>(
    () => new Map(),
  );
  const [revealCap, setRevealCap] = useState(TILE_REVEAL_CAP);
  const [invert, setInvert] = useState(false);
  const [copied, setCopied] = useState(false);
  // Mobile only: the filter sidebar collapses into a bottom sheet toggled here.
  const [sheetOpen, setSheetOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Anchor for shift-click range selection (the last tile toggled).
  const lastClickedRef = useRef<string | null>(null);

  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get('url');
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
    void runScan(url).then(setState);
  }, []);

  const images = state.kind === 'results' ? state.result.images : NO_IMAGES;

  // Best-known width: measured (load-time truth) preferred over declared.
  const widthOf = useCallback((img: ScanImage) => measured.get(img.id)?.w ?? img.width, [measured]);

  const filtered = useMemo(
    () => applyFilters(images, { query, formats, groups }),
    [images, query, formats, groups],
  );

  // Frozen sort: this memo deliberately omits `measured` from its deps.
  // Measured dimensions arriving on image load refresh the badges (they re-run
  // widthOf during render) but must NOT reorder tiles under the pointer.
  // Re-picking a sort (sortKey change) or changing the filter recomputes the
  // order with the newest widths.
  const sorted = useMemo(() => sortImages(filtered, sortKey, widthOf), [filtered, sortKey]);

  const visible = useMemo(() => sorted.slice(0, revealCap), [sorted, revealCap]);

  // Applying a filter resets the reveal window to the first cap of the filtered
  // set (sort reorders the same set, so it keeps the window).
  useEffect(() => {
    setRevealCap(TILE_REVEAL_CAP);
  }, [query, formats, groups]);

  // Incremental reveal: append another batch when the sentinel scrolls near.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealCap((cap) => Math.min(cap + TILE_REVEAL_CAP, sorted.length));
        }
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [sorted.length]);

  // Faceted counts — Format honours the active Source + query; Source honours
  // the active Format + query. The shown format rows are fixed from the full
  // manifest so they never reflow (canonicalFormats).
  const filterState: FilterState = { query, formats, groups };
  const formatOrder = useMemo(() => canonicalFormats(), []);
  const fmtCounts = useMemo(() => formatCounts(images, filterState), [images, query, groups]);
  const allFmtCount = useMemo(() => formatAllCount(images, filterState), [images, query, groups]);
  const grpCounts = useMemo(() => groupCounts(images, filterState), [images, query, formats]);
  const knownWidth = useMemo(() => knownWidthCount(filtered, widthOf), [filtered, widthOf]);

  const onMeasured = useCallback((id: string, w: number, h: number) => {
    setMeasured((prev) => {
      const next = new Map(prev);
      next.set(id, { w, h });
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

  // Whole-tile toggle. Shift-click extends a range from the last-clicked tile
  // across the CURRENT filtered+sorted order; a plain click toggles one.
  const handleTileToggle = (id: string, shift: boolean) => {
    const anchor = lastClickedRef.current;
    if (shift && anchor && anchor !== id) {
      setSelected((prev) => selectRange(prev, sorted, anchor, id));
    } else {
      setSelected((prev) => toggleId(prev, id));
    }
    lastClickedRef.current = id;
  };
  const handleSelectAll = () => setSelected((prev) => selectAll(prev, filtered));
  const handleClear = () => setSelected(new Set());
  const handleInvert = () => setSelected((prev) => invertWithin(prev, filtered));
  // Mobile sheet "Clear" resets the filters (not sort/invert, which aren't
  // filters); the count feeds the Filters trigger label.
  const clearFilters = () => {
    setQuery('');
    setFormats(new Set());
    setGroups(new Set());
  };
  const activeFilterCount = formats.size + groups.size + (query ? 1 : 0);
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
    query,
    onQuery: setQuery,
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
    knownWidth,
    filteredCount: filtered.length,
    invert,
    onInvert: setInvert,
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
          {state.result.truncated !== undefined && <TruncatedBanner reason={state.result.truncated} />}
          <div className="flex gap-md">
            {/* Desktop sidebar. Below the md breakpoint it disappears and the
                same controls open as a bottom sheet (see below). */}
            <aside className="hidden shrink-0 md:block" style={{ width: 'var(--layout-sidebar)' }}>
              <ResultsSidebar instanceId="desktop" {...sidebarProps} />
            </aside>

            <div className="min-w-0 flex-1">
              <p className="mb-sm font-mono text-label uppercase text-muted">
                Showing {visible.length} of {sorted.length}
              </p>
              {sorted.length === 0 ? (
                <p className="py-lg text-small text-muted">No images match these filters.</p>
              ) : (
                <ul className="results-grid">
                  {visible.map((image) => (
                    <ImageCard
                      key={image.id}
                      image={image}
                      selected={selected.has(image.id)}
                      invert={invert}
                      onToggle={handleTileToggle}
                      onMeasured={onMeasured}
                    />
                  ))}
                </ul>
              )}
              {revealCap < sorted.length && <div ref={sentinelRef} aria-hidden="true" />}
            </div>
          </div>

          {/* Bottom chrome: the selection bar. On mobile it is two rows and
              carries the Filters trigger; on desktop a single row. Sticky so it
              pins to the viewport bottom while the grid scrolls. */}
          <div className="sticky bottom-0 z-30 mt-md">
            <SelectionBar
              total={images.length}
              selectedCount={selected.size}
              filteredCount={filtered.length}
              copied={copied}
              activeFilterCount={activeFilterCount}
              filtersOpen={sheetOpen}
              onOpenFilters={() => setSheetOpen(true)}
              onSelectAll={handleSelectAll}
              onClear={handleClear}
              onInvert={handleInvert}
              onCopy={handleCopy}
            />
          </div>

          {/* Mobile filter sheet — the same ResultsSidebar over a dimming
              scrim, stopping above the bottom bars so the selection bar stays
              visible. Live filters, so Apply just dismisses; Clear resets. */}
          {sheetOpen && (
            <div className="md:hidden">
              <button
                type="button"
                aria-label="Close filters"
                onClick={() => setSheetOpen(false)}
                className="filter-scrim"
              />
              <div
                className="filter-sheet rounded-sm bg-surface"
                role="dialog"
                aria-modal="true"
                aria-label="Filters"
              >
                <div className="min-h-0 flex-1 overflow-y-auto border-t border-border p-md">
                  <ResultsSidebar instanceId="mobile" {...sidebarProps} />
                </div>
                <div className="flex gap-md border-t border-border bg-surface p-md">
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="rounded-sm border border-border px-md py-xs font-mono text-label uppercase text-text"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setSheetOpen(false)}
                    className="flex-1 rounded-sm bg-accent px-md py-xs font-mono text-label uppercase text-surface"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
  }
}
