import { formatBytes } from '../lib/results-model';

/**
 * Selection bar — a plain bar; the parent positions it (sticky at the bottom).
 * Desktop is a single row: count/size on the left, actions + Download on the
 * right. Mobile is two rows so nothing overflows: row 1 the four actions, row 2
 * the Filters trigger + count/size on the left and Download on the right.
 *
 * The size total never silently undercounts: every selected member is summed,
 * named unknown, counted as sizing, or covered by the Calculate-size action —
 * which names its own cost ("Calculate size (487)"); the count IS the
 * confirmation. Download ZIP stays fully disabled (step 4), never
 * enabled-but-no-op.
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

function DownloadZip({ className }: { className: string }) {
  return (
    <button
      type="button"
      disabled
      title="ZIP download ships with the download release"
      className={`rounded-md bg-border px-md py-xs font-mono text-label uppercase text-light-muted ${className}`}
    >
      Download ZIP
    </button>
  );
}

export default function SelectionBar({
  total,
  selectedCount,
  filteredCount,
  copied,
  activeFilterCount,
  filtersOpen,
  summary,
  onOpenFilters,
  onSelectAll,
  onClear,
  onInvert,
  onCopy,
  onCalculateSize,
  onCancelSizing,
}: {
  total: number;
  selectedCount: number;
  filteredCount: number;
  copied: boolean;
  activeFilterCount: number;
  filtersOpen: boolean;
  summary: SizeSummaryView;
  onOpenFilters: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onInvert: () => void;
  onCopy: () => void;
  onCalculateSize: () => void;
  onCancelSizing: () => void;
}) {
  const hasSelection = selectedCount > 0;

  const sizeText = summary.knownCount > 0 ? formatBytes(summary.knownBytes) : '—';
  const info = (
    <span className="flex items-center gap-xs font-mono text-label uppercase text-muted">
      {hasSelection ? (
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
        </>
      ) : (
        `${total} image${total === 1 ? '' : 's'} found`
      )}
    </span>
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
        <DownloadZip className="hidden md:inline-flex" />
      </div>

      {/* Count + size + Calculate/Sizing — its own mobile row (row 2): the
          size strings share a row with nothing, so "Calculate size (487)"
          and "sizing 42… Cancel" can never crowd the chrome. Desktop left. */}
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
        <DownloadZip className="" />
      </div>
    </div>
  );
}
