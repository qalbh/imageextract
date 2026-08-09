/**
 * Sticky selection bar. At zero selected it reports the manifest size and the
 * Download is disabled; with a selection it shows the count and the actions.
 *
 * Two things are deliberately inert this pass: the byte-size total renders an em
 * dash (no HEAD probing — Phase 8), and Download ZIP is fully disabled (ZIP
 * assembly is Phase 3), never enabled-but-no-op.
 */
export default function SelectionBar({
  total,
  selectedCount,
  filteredCount,
  copied,
  onSelectAll,
  onClear,
  onInvert,
  onCopy,
}: {
  total: number;
  selectedCount: number;
  filteredCount: number;
  copied: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onInvert: () => void;
  onCopy: () => void;
}) {
  const hasSelection = selectedCount > 0;
  const actionClass =
    'font-mono text-label uppercase text-muted enabled:hover:text-text disabled:text-light-muted';

  return (
    <div
      className="sticky bottom-0 mt-md flex items-center justify-between gap-md border-t border-border bg-surface px-md"
      style={{ height: 'var(--layout-stickybar)' }}
    >
      <span className="font-mono text-label uppercase text-muted">
        {hasSelection ? (
          <>
            {selectedCount} selected · <span>—</span>
          </>
        ) : (
          `${total} image${total === 1 ? '' : 's'} found`
        )}
      </span>

      <div className="flex items-center gap-md">
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
        <button
          type="button"
          disabled
          title="ZIP download ships with the download release"
          className="rounded-sm bg-border px-md py-xs font-mono text-label uppercase text-light-muted"
        >
          Download ZIP
        </button>
      </div>
    </div>
  );
}
