/**
 * Selection bar — a plain bar; the parent positions it (sticky at the bottom).
 * Desktop is a single row: count/size on the left, actions + Download on the
 * right. Mobile is two rows so nothing overflows: row 1 the four actions, row 2
 * the Filters trigger + count/size on the left and Download on the right.
 *
 * Two things are deliberately inert this pass: the byte-size total renders an em
 * dash (no HEAD probing — Phase 8), and Download ZIP is fully disabled (ZIP
 * assembly is Phase 3), never enabled-but-no-op.
 */
const actionClass =
  'font-mono text-label uppercase text-muted enabled:hover:text-text disabled:text-light-muted';

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
  onOpenFilters,
  onSelectAll,
  onClear,
  onInvert,
  onCopy,
}: {
  total: number;
  selectedCount: number;
  filteredCount: number;
  copied: boolean;
  activeFilterCount: number;
  filtersOpen: boolean;
  onOpenFilters: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onInvert: () => void;
  onCopy: () => void;
}) {
  const hasSelection = selectedCount > 0;

  const info = (
    <span className="font-mono text-label uppercase text-muted">
      {hasSelection ? (
        <>
          {selectedCount} selected · <span>—</span>
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

      {/* Filters trigger (mobile only) + count/size; Download at the right —
          mobile row 2; desktop left side. */}
      <div className="flex flex-1 items-center justify-between gap-sm border-t border-border md:order-1 md:flex-none md:gap-md md:border-t-0">
        <div className="flex items-center gap-sm md:gap-md">
          <button
            type="button"
            onClick={onOpenFilters}
            aria-expanded={filtersOpen}
            className="rounded-md border border-border px-sm py-xs font-mono text-label uppercase text-text md:hidden"
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
          {info}
        </div>
        <DownloadZip className="md:hidden" />
      </div>
    </div>
  );
}
