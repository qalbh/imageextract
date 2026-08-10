import type { ComponentChildren } from 'preact';
import type { ImageExt } from '../lib/extract';
import {
  MEASURE_WARN_AT,
  METRIC_SORTS,
  SORT_OPTIONS,
  SOURCE_GROUPS,
  formatLabel,
  type SortDirection,
  type SortKey,
  type SourceGroupId,
} from '../lib/results-model';

/**
 * Presentational sidebar — format filter, sort, the collapsed source-group
 * filter, and the invert-background display switch, in sections divided by
 * hairlines. All state and faceted counts are computed by the parent
 * (ResultsGrid) and passed in.
 *
 * Type rule (design-system.md): mono is for the SECTION HEADINGS (and badges/
 * metadata elsewhere); every interactive option row — names, counts, sort
 * options, display labels — is sans at text-small.
 *
 * Controls follow one rule: checkboxes and radios are for FILTERING (format,
 * source, sort); the pill switch is for a DISPLAY MODE (invert).
 *
 * Faceting: counts reflect the set filtered by the *other* groups. A row whose
 * faceted count is zero renders disabled and muted rather than disappearing, so
 * the list never reflows under the pointer.
 *
 * The filename/URL search CONTROL was removed (2026-08-10, per design); the
 * capability stays in results-model.ts (query in FilterState, tested) and
 * reinstating it is one input.
 */

function SectionLabel({ children }: { children: ComponentChildren }) {
  return <p className="mb-xs font-mono text-label uppercase text-muted">{children}</p>;
}

export default function ResultsSidebar({
  instanceId,
  formatOrder,
  formats,
  formatCounts,
  allCount,
  onToggleFormat,
  onClearFormats,
  groups,
  groupCounts,
  onToggleGroup,
  sortKey,
  onSort,
  sortDir,
  onSortDir,
  dimsCounts,
  measureCount,
  measuring,
  onMeasure,
  onCancelMeasure,
  filteredCount,
  invert,
  onInvert,
}: {
  // Distinguishes the two mounted instances (desktop aside + mobile sheet) so
  // the sort radio group name stays unique in the DOM.
  instanceId: string;
  formatOrder: ImageExt[];
  formats: ReadonlySet<ImageExt>;
  formatCounts: Map<ImageExt, number>;
  allCount: number;
  onToggleFormat: (ext: ImageExt) => void;
  onClearFormats: () => void;
  groups: ReadonlySet<SourceGroupId>;
  groupCounts: Map<SourceGroupId, number>;
  onToggleGroup: (id: SourceGroupId) => void;
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
  sortDir: SortDirection;
  onSortDir: (dir: SortDirection) => void;
  dimsCounts: { width: number; height: number; imagesize: number };
  measureCount: number;
  measuring: boolean;
  onMeasure: () => void;
  onCancelMeasure: () => void;
  filteredCount: number;
  invert: boolean;
  onInvert: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-col divide-y divide-border">
      {/* Format filter */}
      <div className="pb-md">
        <SectionLabel>Format</SectionLabel>
        <ul className="flex flex-col">
          <li>
            <label className="flex cursor-pointer items-center justify-between gap-xs py-xs">
              <span className="flex items-center gap-xs">
                <input
                  type="checkbox"
                  checked={formats.size === 0}
                  onChange={onClearFormats}
                  className="accent-accent"
                />
                <span className="text-small text-text">All</span>
              </span>
              <span className="text-small text-muted">{allCount}</span>
            </label>
          </li>
          {formatOrder.map((ext) => {
            const count = formatCounts.get(ext) ?? 0;
            const checked = formats.has(ext);
            const disabled = count === 0 && !checked;
            return (
              <li key={ext}>
                <label
                  className={`flex items-center justify-between gap-xs py-xs ${
                    disabled ? 'cursor-default' : 'cursor-pointer'
                  }`}
                >
                  <span className="flex items-center gap-xs">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onToggleFormat(ext)}
                      className="accent-accent"
                    />
                    <span className={`text-small ${disabled ? 'text-light-muted' : 'text-text'}`}>
                      {formatLabel(ext)}
                    </span>
                  </span>
                  <span className={`text-small ${disabled ? 'text-light-muted' : 'text-muted'}`}>
                    {count}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Sort — one row per key; direction is a separate toggle applied to
          the metric sorts (Image size / Width / Height), not doubled rows.
          The toggle is a TEXT button, not the pill: the pill is canonical
          for on/off display MODES, and a direction is two named values of a
          sort parameter — a labelled button states its current value, which
          a pill cannot ("descending: on" is nonsense). */}
      <div className="py-md">
        <SectionLabel>Sort by</SectionLabel>
        <ul className="flex flex-col">
          {SORT_OPTIONS.map((option) => {
            const known =
              option.key === 'width' ? dimsCounts.width
              : option.key === 'height' ? dimsCounts.height
              : option.key === 'imagesize' ? dimsCounts.imagesize
              : null;
            return (
              <li key={option.key}>
                <label className="flex cursor-pointer items-center gap-xs py-xs">
                  <input
                    type="radio"
                    name={`results-sort-${instanceId}`}
                    checked={sortKey === option.key}
                    onChange={() => onSort(option.key)}
                    className="accent-accent"
                  />
                  <span className="text-small text-text">{option.label}</span>
                  {known !== null && (
                    <span className="text-small text-muted">
                      {known} of {filteredCount}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
        {METRIC_SORTS.has(sortKey) && (
          <button
            type="button"
            onClick={() => onSortDir(sortDir === 'largest' ? 'smallest' : 'largest')}
            className="mt-xs font-mono text-label uppercase text-muted hover:text-text"
          >
            {sortDir === 'largest' ? '↓ Largest first' : '↑ Smallest first'}
          </button>
        )}
        <p className="mt-xs font-mono text-label uppercase text-muted">Unknown sizes sorted last</p>
        {/* Measure: exact dimensions via one prefix Range per image, parsed
            from the file header. Explicit action — a sort click never spends
            subrequests on its own; the count is the consent, and past
            MEASURE_WARN_AT the count alone isn't informed consent, so the
            note names the budget. */}
        {METRIC_SORTS.has(sortKey) && measuring && (
          <p className="mt-xs flex items-center gap-xs font-mono text-label uppercase text-muted">
            <span>Measuring…</span>
            <button type="button" onClick={onCancelMeasure} className="uppercase hover:text-text">
              Cancel
            </button>
          </p>
        )}
        {METRIC_SORTS.has(sortKey) && !measuring && measureCount > 0 && (
          <>
            <button
              type="button"
              onClick={onMeasure}
              className="mt-xs font-mono text-label uppercase text-accent hover:underline"
            >
              Measure dimensions ({measureCount})
            </button>
            {measureCount >= MEASURE_WARN_AT && (
              <p className="mt-xs font-mono text-label uppercase text-muted">
                Uses a large share of the hourly request allowance
              </p>
            )}
          </>
        )}
      </div>

      {/* Source filter — collapsed by default; a developer affordance. Native
          <details> gives the disclosure with zero JS and the browser's own
          chevron, so no icon asset is needed. */}
      <details className="py-md">
        <summary className="cursor-pointer font-mono text-label uppercase text-muted">Source</summary>
        <ul className="mt-xs flex flex-col">
          {SOURCE_GROUPS.map((group) => {
            const count = groupCounts.get(group.id) ?? 0;
            const checked = groups.has(group.id);
            const disabled = count === 0 && !checked;
            return (
              <li key={group.id}>
                <label
                  className={`flex items-center justify-between gap-xs py-xs ${
                    disabled ? 'cursor-default' : 'cursor-pointer'
                  }`}
                >
                  <span className="flex items-center gap-xs">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onToggleGroup(group.id)}
                      className="accent-accent"
                    />
                    <span className={`text-small ${disabled ? 'text-light-muted' : 'text-text'}`}>
                      {group.label}
                    </span>
                  </span>
                  <span className={`text-small ${disabled ? 'text-light-muted' : 'text-muted'}`}>
                    {count}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </details>

      {/* Display — the pill switch; list view is deferred, so this section
          holds only Invert background. */}
      <div className="pt-md">
        <SectionLabel>Display</SectionLabel>
        <div className="flex items-center justify-between gap-xs py-xs">
          <span className="text-small text-text">Invert background</span>
          <button
            type="button"
            role="switch"
            aria-checked={invert}
            aria-label="Invert background"
            onClick={() => onInvert(!invert)}
            className="toggle"
          />
        </div>
      </div>
    </div>
  );
}
