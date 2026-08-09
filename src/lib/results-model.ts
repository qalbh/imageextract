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

const GROUP_OF: Record<ImageSource, SourceGroupId> = (() => {
  const map = {} as Record<ImageSource, SourceGroupId>;
  for (const group of SOURCE_GROUPS) for (const source of group.sources) map[source] = group.id;
  return map;
})();

export function sourceGroupOf(source: ImageSource): SourceGroupId {
  return GROUP_OF[source];
}

// Stable format order for the sidebar. The list of *shown* formats is fixed
// from the full manifest (see canonicalFormats) so rows never appear/disappear
// as counts change; faceting only zeroes their counts.
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

export function canonicalFormats(images: readonly ScanImage[]): ImageExt[] {
  const present = new Set(images.map((img) => img.ext));
  return FORMAT_ORDER.filter((ext) => present.has(ext));
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
export type SortKey = 'document' | 'width' | 'name' | 'type';

export const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'document', label: 'Document order' },
  { key: 'width', label: 'Width' },
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
];

export function sortImages(
  images: readonly ScanImage[],
  key: SortKey,
  widthOf: (img: ScanImage) => number | undefined,
): ScanImage[] {
  const arr = images.slice();
  switch (key) {
    case 'document':
      // Input arrives in document order (extractor order, preserved by
      // applyFilters), so identity is the document sort.
      return arr;
    case 'name':
      return arr.sort((a, b) => a.filename.toLowerCase().localeCompare(b.filename.toLowerCase()));
    case 'type':
      return arr.sort(
        (a, b) =>
          a.ext.localeCompare(b.ext) ||
          a.filename.toLowerCase().localeCompare(b.filename.toLowerCase()),
      );
    case 'width':
      return arr.sort((a, b) => {
        const wa = widthOf(a);
        const wb = widthOf(b);
        if (wa === undefined && wb === undefined) return 0; // stable: keep document order
        if (wa === undefined) return 1; // unknowns last
        if (wb === undefined) return -1;
        return wb - wa; // largest first
      });
  }
}

export function knownWidthCount(
  images: readonly ScanImage[],
  widthOf: (img: ScanImage) => number | undefined,
): number {
  let n = 0;
  for (const img of images) if (widthOf(img) !== undefined) n += 1;
  return n;
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
