import type { ComponentChildren } from 'preact';
import type { ImageExt } from '../lib/extract';
import {
  SORT_OPTIONS,
  SOURCE_GROUPS,
  type SortKey,
  type SourceGroupId,
} from '../lib/results-model';

/**
 * Presentational sidebar — filename search, format filter, sort, the collapsed
 * source-group filter, and the invert-background display toggle. All state and
 * faceted counts are computed by the parent (ResultsGrid) and passed in.
 *
 * Faceting: counts reflect the set filtered by the *other* groups. A row whose
 * faceted count is zero renders disabled and muted rather than disappearing, so
 * the list never reflows under the pointer.
 */

const FORMAT_LABEL: Partial<Record<ImageExt, string>> = { jpeg: 'JPG', unknown: 'Other' };
const formatLabel = (ext: ImageExt) => FORMAT_LABEL[ext] ?? ext.toUpperCase();

function SectionLabel({ children }: { children: ComponentChildren }) {
  return <p className="mb-xs font-mono text-label uppercase text-muted">{children}</p>;
}

export default function ResultsSidebar({
  query,
  onQuery,
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
  knownWidth,
  filteredCount,
  invert,
  onInvert,
}: {
  query: string;
  onQuery: (value: string) => void;
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
  knownWidth: number;
  filteredCount: number;
  invert: boolean;
  onInvert: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-lg">
      {/* Filename / URL search */}
      <div>
        <label htmlFor="results-search" className="mb-xs block font-mono text-label uppercase text-muted">
          Find
        </label>
        <input
          id="results-search"
          type="search"
          value={query}
          onInput={(event) => onQuery((event.target as HTMLInputElement).value)}
          placeholder="Filename or URL"
          className="w-full rounded-sm border border-border bg-surface px-sm py-xs font-mono text-caption text-text placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </div>

      {/* Format filter */}
      <div>
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
                <span className="font-mono text-label uppercase text-text">All</span>
              </span>
              <span className="font-mono text-label text-muted">{allCount}</span>
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
                    <span className={`font-mono text-label uppercase ${disabled ? 'text-light-muted' : 'text-text'}`}>
                      {formatLabel(ext)}
                    </span>
                  </span>
                  <span className={`font-mono text-label ${disabled ? 'text-light-muted' : 'text-muted'}`}>
                    {count}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Sort */}
      <div>
        <SectionLabel>Sort by</SectionLabel>
        <ul className="flex flex-col">
          {SORT_OPTIONS.map((option) => (
            <li key={option.key}>
              <label className="flex cursor-pointer items-center gap-xs py-xs">
                <input
                  type="radio"
                  name="results-sort"
                  checked={sortKey === option.key}
                  onChange={() => onSort(option.key)}
                  className="accent-accent"
                />
                <span className="font-mono text-label uppercase text-text">{option.label}</span>
                {option.key === 'width' && (
                  <span className="font-mono text-label text-muted">
                    {knownWidth} of {filteredCount}
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-xs font-mono text-label uppercase text-muted">Unknown sizes sorted last</p>
      </div>

      {/* Source filter — collapsed by default; a developer affordance. Native
          <details> gives the disclosure with zero JS and the browser's own
          chevron, so no icon asset is needed. */}
      <details>
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
                    <span className={`font-mono text-label uppercase ${disabled ? 'text-light-muted' : 'text-text'}`}>
                      {group.label}
                    </span>
                  </span>
                  <span className={`font-mono text-label ${disabled ? 'text-light-muted' : 'text-muted'}`}>
                    {count}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </details>

      {/* Display */}
      <div>
        <SectionLabel>Display</SectionLabel>
        <label className="flex cursor-pointer items-center justify-between gap-xs py-xs">
          <span className="font-mono text-label uppercase text-text">Invert background</span>
          <input
            type="checkbox"
            checked={invert}
            onChange={(event) => onInvert((event.target as HTMLInputElement).checked)}
            className="accent-accent"
          />
        </label>
      </div>
    </div>
  );
}
