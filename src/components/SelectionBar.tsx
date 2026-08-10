import { formatBytes } from '../lib/results-model';
import { MAX_ZIP_IMAGES } from '../lib/zip';

/**
 * Selection bar — a plain bar; the parent positions it (sticky at the bottom).
 * Desktop is a single row: count/size on the left, actions + Download on the
 * right. Mobile is three rows: actions; count + size + probe/zip status on
 * their own row (so the strings never crowd the chrome); Filters + Download.
 *
 * The size total never silently undercounts: every selected member is summed,
 * named unknown, counted as sizing, or covered by the Calculate-size action —
 * which names its own cost ("Calculate size (487)"); the count IS the
 * confirmation. Download ZIP is blocked (with the reason stated), never
 * truncated, above MAX_ZIP_IMAGES; while assembling, the Cancel control
 * carries its consequence in its own label — on the Blob path cancelling
 * discards everything, and the user must know BEFORE clicking, not after.
 */
const actionClass =
  'font-mono text-label uppercase text-muted enabled:hover:text-text disabled:text-light-muted';

export interface SizeSummaryView {
  knownBytes: number;
  knownCount: number;
  unknownCount: number;
  pendingCount: number;
  unprobedCount: number;
}

export interface ZipView {
  phase: 'assembling' | 'done';
  done: number;
  failed: number;
  total: number;
  skipped: number;
}

export default function SelectionBar({
  total,
  selectedCount,
  filteredCount,
  copied,
  activeFilterCount,
  filtersOpen,
  summary,
  zip,
  onOpenFilters,
  onSelectAll,
  onClear,
  onInvert,
  onCopy,
  onCalculateSize,
  onCancelSizing,
  onDownloadZip,
  onCancelZip,
}: {
  total: number;
  selectedCount: number;
  filteredCount: number;
  copied: boolean;
  activeFilterCount: number;
  filtersOpen: boolean;
  summary: SizeSummaryView;
  zip: ZipView | null;
  onOpenFilters: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onInvert: () => void;
  onCopy: () => void;
  onCalculateSize: () => void;
  onCancelSizing: () => void;
  onDownloadZip: () => void;
  onCancelZip: () => void;
}) {
  const hasSelection = selectedCount > 0;
  const overCap = selectedCount > MAX_ZIP_IMAGES;
  const assembling = zip?.phase === 'assembling';
  const zipEnabled = hasSelection && !overCap && !assembling;

  const sizeText = summary.knownCount > 0 ? formatBytes(summary.knownBytes) : '—';
  const info = (
    <span className="flex items-center gap-xs font-mono text-label uppercase text-muted">
      {zip !== null ? (
        zip.phase === 'assembling' ? (
          <>
            <span>
              Zipping {zip.done + zip.failed}/{zip.total}
              {zip.failed > 0 ? ` · ${zip.failed} failed` : ''}
            </span>
            <button type="button" onClick={onCancelZip} className={actionClass}>
              Cancel (discards ZIP)
            </button>
          </>
        ) : (
          <span>
            ZIP saved · {zip.done} of {zip.total}
            {zip.skipped > 0 ? ` (${zip.skipped} skipped)` : ''}
          </span>
        )
      ) : hasSelection ? (
        <>
          <span>
            {selectedCount} selected · {sizeText}
            {summary.unknownCount > 0 ? ` + ${summary.unknownCount} unknown` : ''}
          </span>
          {summary.pendingCount > 0 ? (
            <>
              <span>· sizing {summary.pendingCount}…</span>
              <button type="button" onClick={onCancelSizing} className={actionClass}>
                Cancel
              </button>
            </>
          ) : summary.unprobedCount > 0 ? (
            <button type="button" onClick={onCalculateSize} className={actionClass}>
              Calculate size ({summary.unprobedCount})
            </button>
          ) : null}
          {overCap ? <span>· ZIP capped at {MAX_ZIP_IMAGES} images — narrow the selection</span> : null}
        </>
      ) : (
        `${total} image${total === 1 ? '' : 's'} found`
      )}
    </span>
  );

  const downloadZip = (className: string) => (
    <button
      type="button"
      disabled={!zipEnabled}
      onClick={onDownloadZip}
      title={
        overCap
          ? `ZIP is capped at ${MAX_ZIP_IMAGES} images`
          : assembling
            ? 'Assembly in progress'
            : undefined
      }
      className={`rounded-md px-md py-xs font-mono text-label uppercase ${
        zipEnabled ? 'bg-accent text-surface' : 'bg-border text-light-muted'
      } ${className}`}
    >
      Download ZIP
    </button>
  );

  return (
    <div className="selection-bar flex flex-col border-t border-border bg-surface px-sm md:flex-row md:items-center md:justify-between md:gap-md md:px-md">
      {/* Actions — mobile row 1; desktop right side. */}
      <div className="flex flex-1 items-center justify-between gap-sm md:order-2 md:flex-none md:gap-md">
        <button type="button" onClick={onSelectAll} disabled={filteredCount === 0} className={actionClass}>
          Select all ({filteredCount})
        </button>
        <button type="button" onClick={onClear} disabled={!hasSelection} className={actionClass}>
          Clear
        </button>
        <button type="button" onClick={onInvert} disabled={filteredCount === 0} className={actionClass}>
          Invert selection
        </button>
        <button type="button" onClick={onCopy} disabled={!hasSelection} className={actionClass}>
          {copied ? 'Copied' : 'Copy URLs'}
        </button>
        {downloadZip('hidden md:inline-flex')}
      </div>

      {/* Count + size + probe/zip status — its own mobile row (row 2). */}
      <div className="flex flex-1 items-center border-t border-border md:order-1 md:flex-none md:border-t-0">
        {info}
      </div>

      {/* Mobile chrome — row 3: Filters trigger + Download ZIP. */}
      <div className="flex flex-1 items-center justify-between gap-sm border-t border-border md:hidden">
        <button
          type="button"
          onClick={onOpenFilters}
          aria-expanded={filtersOpen}
          className="rounded-md border border-border px-sm py-xs font-mono text-label uppercase text-text"
        >
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
        {downloadZip('')}
      </div>
    </div>
  );
}
