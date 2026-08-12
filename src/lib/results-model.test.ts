import { describe, expect, it } from 'vitest';
import { IMAGE_SOURCES, type ImageExt, type ImageSource, type ScanImage } from './extract';
import {
  ICON_SOURCES,
  SOURCE_GROUPS,
  applyFilters,
  canProxyFallback,
  canonicalFormats,
  dataUriBytes,
  downloadHref,
  formatBytes,
  formatAllCount,
  formatCounts,
  formatLabel,
  groupCounts,
  invertWithin,
  dimsKnownCounts,
  matchesQuery,
  parseFormatParam,
  parseSourceParam,
  proxyUrl,
  selectAll,
  selectRange,
  selectedUrls,
  sizeSummary,
  sortImages,
  sourceGroupOf,
  toggleId,
  type FilterState,
  type SizeEntry,
} from './results-model';

// Compact ScanImage builder for fixtures.
let seq = 0;
function img(partial: Partial<ScanImage> & { source: ImageSource; ext: ImageExt }): ScanImage {
  seq += 1;
  return {
    id: partial.id ?? `id-${seq}`,
    url: partial.url ?? `https://example.com/${partial.filename ?? `img-${seq}`}.${partial.ext}`,
    filename: partial.filename ?? `img-${seq}`,
    ext: partial.ext,
    source: partial.source,
    width: partial.width,
    height: partial.height,
    dimensionSource: partial.dimensionSource,
    variantGroup: partial.variantGroup,
  };
}

const NO_FILTER: FilterState = { query: '', formats: new Set(), groups: new Set() };

describe('SOURCE_GROUPS', () => {
  it('covers every IMAGE_SOURCE exactly once', () => {
    const seen = new Map<ImageSource, number>();
    for (const group of SOURCE_GROUPS) {
      for (const source of group.sources) seen.set(source, (seen.get(source) ?? 0) + 1);
    }
    // Every source is placed…
    for (const source of IMAGE_SOURCES) {
      expect(seen.get(source), `${source} is not in any SOURCE_GROUP`).toBe(1);
    }
    // …and no source is placed twice or in a stray extra bucket.
    expect([...seen.keys()].sort()).toEqual([...IMAGE_SOURCES].sort());
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
  });

  it('has unique ids', () => {
    const ids = SOURCE_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ICON_SOURCES is a subset of IMAGE_SOURCES covering the icon-ish sources', () => {
    for (const source of ICON_SOURCES) expect(IMAGE_SOURCES).toContain(source);
    expect(ICON_SOURCES.has('favicon')).toBe(true);
    expect(ICON_SOURCES.has('inline-svg')).toBe(true);
    expect(ICON_SOURCES.has('img')).toBe(false);
  });
});

describe('proxyUrl', () => {
  it('builds the inline proxy URL with the target encoded', () => {
    expect(proxyUrl('https://example.com/a.png')).toBe(
      '/api/proxy?url=https%3A%2F%2Fexample.com%2Fa.png',
    );
  });

  it('encodes query strings and unicode so the target survives round-tripping', () => {
    const url = 'https://cdn.test/img.php?id=1&size=large#frag';
    const built = proxyUrl(url);
    // The target must come back byte-identical when the Worker decodes it —
    // & and # inside the target must not terminate our own query string.
    expect(built).toBe(`/api/proxy?url=${encodeURIComponent(url)}`);
    expect(new URL(built, 'https://ours.test').searchParams.get('url')).toBe(url);
    expect(new URL(proxyUrl('https://cdn.test/naïve.png'), 'https://ours.test').searchParams.get('url')).toBe(
      'https://cdn.test/naïve.png',
    );
  });

  it('appends download=1 only when asked', () => {
    expect(proxyUrl('https://example.com/a.png', { download: true })).toBe(
      '/api/proxy?url=https%3A%2F%2Fexample.com%2Fa.png&download=1',
    );
    expect(proxyUrl('https://example.com/a.png', {})).not.toContain('download');
  });
});

describe('canProxyFallback', () => {
  it('allows http and https URLs', () => {
    expect(canProxyFallback(img({ source: 'img', ext: 'png', url: 'https://cdn.test/a.png' }))).toBe(true);
    expect(canProxyFallback(img({ source: 'stylesheet', ext: 'png', url: 'http://cdn.test/b.png' }))).toBe(true);
  });

  it('rejects data: URIs — the proxy would reject the scheme, so a retry is guaranteed futile', () => {
    // inline-svg entries are serialized to data:image/svg+xml (extract.ts).
    expect(
      canProxyFallback(img({ source: 'inline-svg', ext: 'svg', url: 'data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E' })),
    ).toBe(false);
    expect(canProxyFallback(img({ source: 'img', ext: 'png', url: 'data:image/png;base64,AAAA' }))).toBe(false);
  });
});

describe('downloadHref', () => {
  it('routes http(s) through the proxy with download=1', () => {
    expect(downloadHref(img({ source: 'img', ext: 'png', url: 'https://cdn.test/a.png' }))).toBe(
      '/api/proxy?url=https%3A%2F%2Fcdn.test%2Fa.png&download=1',
    );
  });

  it('points data: URIs at themselves — browsers honour download on data:, no proxy needed', () => {
    const uri = 'data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E';
    expect(downloadHref(img({ source: 'inline-svg', ext: 'svg', url: uri }))).toBe(uri);
  });

  it('sourceGroupOf resolves each source to its bucket', () => {
    expect(sourceGroupOf('img')).toBe('page');
    expect(sourceGroupOf('srcset')).toBe('page');
    expect(sourceGroupOf('stylesheet')).toBe('css');
    expect(sourceGroupOf('inline-svg')).toBe('svg');
    expect(sourceGroupOf('favicon')).toBe('meta');
    expect(sourceGroupOf('embed')).toBe('media');
  });
});

describe('matchesQuery', () => {
  const it1 = img({ source: 'img', ext: 'png', filename: 'Hero-Banner', url: 'https://cdn.test/assets/Hero-Banner.png' });

  it('empty query matches everything', () => {
    expect(matchesQuery(it1, '')).toBe(true);
  });
  it('matches filename case-insensitively', () => {
    expect(matchesQuery(it1, 'hero')).toBe(true);
    expect(matchesQuery(it1, 'BANNER')).toBe(true);
  });
  it('matches within the URL, not just the filename', () => {
    expect(matchesQuery(it1, 'cdn.test')).toBe(true);
    expect(matchesQuery(it1, '/assets/')).toBe(true);
  });
  it('non-matches return false', () => {
    expect(matchesQuery(it1, 'nope')).toBe(false);
  });
});

describe('applyFilters — OR within a group, AND across groups', () => {
  const set = [
    img({ source: 'img', ext: 'png', filename: 'a' }),
    img({ source: 'img', ext: 'jpeg', filename: 'b' }),
    img({ source: 'stylesheet', ext: 'png', filename: 'c' }),
    img({ source: 'inline-svg', ext: 'svg', filename: 'd' }),
  ];

  it('empty filter returns all, in order', () => {
    expect(applyFilters(set, NO_FILTER).map((i) => i.filename)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('OR within the format group', () => {
    const out = applyFilters(set, { query: '', formats: new Set<ImageExt>(['png', 'svg']), groups: new Set() });
    expect(out.map((i) => i.filename)).toEqual(['a', 'c', 'd']);
  });

  it('OR within the source group', () => {
    const out = applyFilters(set, { query: '', formats: new Set(), groups: new Set(['page', 'svg']) });
    expect(out.map((i) => i.filename)).toEqual(['a', 'b', 'd']);
  });

  it('AND across format + source + query', () => {
    // png AND page-group AND matches "a" → only tile a (c is png but css group).
    const out = applyFilters(set, {
      query: 'a',
      formats: new Set<ImageExt>(['png']),
      groups: new Set(['page']),
    });
    expect(out.map((i) => i.filename)).toEqual(['a']);
  });
});

describe('faceted counts', () => {
  const set = [
    img({ source: 'img', ext: 'png' }),
    img({ source: 'img', ext: 'png' }),
    img({ source: 'img', ext: 'jpeg' }),
    img({ source: 'stylesheet', ext: 'png' }),
    img({ source: 'inline-svg', ext: 'svg' }),
  ];

  it('format counts ignore the format selection but honour source', () => {
    // With source filtered to the page group, only the 3 img tiles count.
    const counts = formatCounts(set, { query: '', formats: new Set<ImageExt>(['jpeg']), groups: new Set(['page']) });
    expect(counts.get('png')).toBe(2);
    expect(counts.get('jpeg')).toBe(1);
    expect(counts.get('svg')).toBeUndefined();
  });

  it('formatAllCount is the faceted total (source applied, format ignored)', () => {
    expect(formatAllCount(set, { query: '', formats: new Set<ImageExt>(['png']), groups: new Set(['page']) })).toBe(3);
    expect(formatAllCount(set, NO_FILTER)).toBe(5);
  });

  it('group counts ignore the source selection but honour format', () => {
    // With format filtered to png, page group has 2, css has 1, svg has 0.
    const counts = groupCounts(set, { query: '', formats: new Set<ImageExt>(['png']), groups: new Set(['css']) });
    expect(counts.get('page')).toBe(2);
    expect(counts.get('css')).toBe(1);
    expect(counts.get('svg')).toBeUndefined();
  });
});

describe('canonicalFormats', () => {
  it('always returns the full supported set in canonical order (rows never removed)', () => {
    // Every ImageExt member must be present so zero-count rows can render
    // disabled rather than disappearing — even for a manifest with one format.
    expect(canonicalFormats()).toEqual(['png', 'jpeg', 'svg', 'gif', 'webp', 'avif', 'ico', 'unknown']);
  });

  it('keeps formats absent from the manifest, with a zero facet count', () => {
    // Regression: JPEG/WEBP/ICO went missing when the list was filtered to
    // present-only. The row must stay (canonicalFormats) and read 0 (facet).
    const pngOnly = [img({ source: 'img', ext: 'png' }), img({ source: 'img', ext: 'png' })];
    expect(canonicalFormats()).toContain('jpeg');
    expect(canonicalFormats()).toContain('webp');
    expect(canonicalFormats()).toContain('ico');
    const counts = formatCounts(pngOnly, NO_FILTER);
    expect(counts.get('png')).toBe(2);
    expect(counts.get('jpeg') ?? 0).toBe(0);
    expect(counts.get('webp') ?? 0).toBe(0);
  });
});

describe('formatLabel', () => {
  it('maps jpeg to JPG and unknown to UNKNOWN (never OTHER)', () => {
    expect(formatLabel('jpeg')).toBe('JPG');
    expect(formatLabel('unknown')).toBe('UNKNOWN');
    expect(formatLabel('png')).toBe('PNG');
    expect(formatLabel('webp')).toBe('WEBP');
  });
});

describe('sortImages', () => {
  const declared = (i: ScanImage) => ({ w: i.width, h: i.height });

  it('document order is identity, unaffected by direction', () => {
    const set = [img({ source: 'img', ext: 'png', filename: 'z' }), img({ source: 'img', ext: 'png', filename: 'a' })];
    expect(sortImages(set, 'document', 'largest', declared).map((i) => i.filename)).toEqual(['z', 'a']);
    expect(sortImages(set, 'document', 'smallest', declared).map((i) => i.filename)).toEqual(['z', 'a']);
  });

  it('name sorts case-insensitively', () => {
    const set = [
      img({ source: 'img', ext: 'png', filename: 'Banana' }),
      img({ source: 'img', ext: 'png', filename: 'apple' }),
      img({ source: 'img', ext: 'png', filename: 'Cherry' }),
    ];
    expect(sortImages(set, 'name', 'largest', declared).map((i) => i.filename)).toEqual(['apple', 'Banana', 'Cherry']);
  });

  it('type sorts by ext then filename', () => {
    const set = [
      img({ source: 'img', ext: 'webp', filename: 'a' }),
      img({ source: 'img', ext: 'png', filename: 'b' }),
      img({ source: 'img', ext: 'png', filename: 'a' }),
    ];
    expect(sortImages(set, 'type', 'largest', declared).map((i) => `${i.ext}/${i.filename}`)).toEqual([
      'png/a',
      'png/b',
      'webp/a',
    ]);
  });

  it('width sorts largest first with unknowns last, stable among unknowns', () => {
    const set = [
      img({ source: 'img', ext: 'png', filename: 'u1' }), // unknown
      img({ source: 'img', ext: 'png', filename: 'w800', width: 800 }),
      img({ source: 'img', ext: 'png', filename: 'u2' }), // unknown
      img({ source: 'img', ext: 'png', filename: 'w1600', width: 1600 }),
    ];
    expect(sortImages(set, 'width', 'largest', declared).map((i) => i.filename)).toEqual(['w1600', 'w800', 'u1', 'u2']);
  });

  it('smallest-first flips knowns but unknowns STAY last', () => {
    const set = [
      img({ source: 'img', ext: 'png', filename: 'u1' }),
      img({ source: 'img', ext: 'png', filename: 'w800', width: 800 }),
      img({ source: 'img', ext: 'png', filename: 'w1600', width: 1600 }),
    ];
    expect(sortImages(set, 'width', 'smallest', declared).map((i) => i.filename)).toEqual(['w800', 'w1600', 'u1']);
  });

  it('imagesize sorts by area and needs BOTH dimensions', () => {
    const set = [
      img({ source: 'img', ext: 'png', filename: 'tall', width: 100, height: 1000 }), // 100k
      img({ source: 'img', ext: 'png', filename: 'wide', width: 900, height: 200 }), // 180k
      img({ source: 'img', ext: 'png', filename: 'widthonly', width: 5000 }), // no area
    ];
    expect(sortImages(set, 'imagesize', 'largest', declared).map((i) => i.filename)).toEqual([
      'wide',
      'tall',
      'widthonly',
    ]);
  });

  it('height sorts on the height metric', () => {
    const set = [
      img({ source: 'img', ext: 'png', filename: 'short', width: 10, height: 100 }),
      img({ source: 'img', ext: 'png', filename: 'tall', width: 10, height: 900 }),
    ];
    expect(sortImages(set, 'height', 'largest', declared).map((i) => i.filename)).toEqual(['tall', 'short']);
  });

  it('measured dims win over declared via dimsOf', () => {
    const a = img({ source: 'img', ext: 'png', filename: 'a', width: 100, height: 100 });
    const b = img({ source: 'img', ext: 'png', filename: 'b', width: 200, height: 200 });
    const measured = new Map([[a.id, { w: 5000, h: 5000 }]]);
    const dimsOf = (i: ScanImage) => measured.get(i.id) ?? { w: i.width, h: i.height };
    expect(sortImages([a, b], 'imagesize', 'largest', dimsOf).map((i) => i.filename)).toEqual(['a', 'b']);
  });
});

describe('dimsKnownCounts', () => {
  it('counts width, height, and both-dims in one pass', () => {
    const set = [
      img({ source: 'img', ext: 'png', width: 100, height: 50 }),
      img({ source: 'srcset', ext: 'png', width: 200 }),
      img({ source: 'inline-svg', ext: 'svg' }),
    ];
    expect(dimsKnownCounts(set, (i) => ({ w: i.width, h: i.height }))).toEqual({
      width: 2,
      height: 1,
      imagesize: 1,
    });
  });
});

describe('selection', () => {
  const set = [
    img({ source: 'img', ext: 'png', id: 'A' }),
    img({ source: 'img', ext: 'jpeg', id: 'B' }),
    img({ source: 'inline-svg', ext: 'svg', id: 'C' }),
  ];

  it('toggleId adds then removes', () => {
    let sel = toggleId(new Set(), 'A');
    expect([...sel]).toEqual(['A']);
    sel = toggleId(sel, 'A');
    expect([...sel]).toEqual([]);
  });

  it('selectAll adds the whole filtered set and preserves selections outside it', () => {
    const pngOnly = applyFilters(set, { query: '', formats: new Set<ImageExt>(['png']), groups: new Set() });
    const sel = selectAll(new Set(['C']), pngOnly); // C selected under a different filter
    expect([...sel].sort()).toEqual(['A', 'C']);
  });

  it('selection survives a filter change (ids hidden by a filter are not pruned)', () => {
    // Select B (jpeg), then filter to svg — B stays in the set.
    const sel = toggleId(new Set(), 'B');
    const svgOnly = applyFilters(set, { query: '', formats: new Set<ImageExt>(['svg']), groups: new Set() });
    // A filter change does not touch the selection; only explicit ops do.
    expect(sel.has('B')).toBe(true);
    // invert within the svg view flips C but leaves B untouched.
    const inverted = invertWithin(sel, svgOnly);
    expect(inverted.has('B')).toBe(true);
    expect(inverted.has('C')).toBe(true);
  });

  it('invertWithin flips only the filtered set', () => {
    const pngOnly = applyFilters(set, { query: '', formats: new Set<ImageExt>(['png']), groups: new Set() });
    const sel = invertWithin(new Set(['A']), pngOnly); // A in filtered → removed; no others added
    expect([...sel]).toEqual([]);
    const sel2 = invertWithin(new Set(['C']), pngOnly); // C outside filtered → kept; A added
    expect([...sel2].sort()).toEqual(['A', 'C']);
  });

  it('selectedUrls returns document-order URLs of the selection', () => {
    const sel = new Set(['C', 'A']);
    expect(selectedUrls(set, sel)).toEqual([set[0]!.url, set[2]!.url]);
  });
});

describe('dataUriBytes', () => {
  it('computes base64 payload size with padding', () => {
    // "hello" = 5 bytes → base64 aGVsbG8= (8 chars, 1 pad)
    expect(dataUriBytes('data:image/png;base64,aGVsbG8=')).toBe(5);
  });

  it('computes percent-encoded payload size in bytes, not chars', () => {
    const svg = '<svg>naïve</svg>';
    const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    expect(dataUriBytes(uri)).toBe(new TextEncoder().encode(svg).length);
  });

  it('returns 0 for a malformed data URI', () => {
    expect(dataUriBytes('data:image/png')).toBe(0);
  });
});

describe('formatBytes', () => {
  it('uses decimal units so the number matches the downloads folder', () => {
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1000)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(8_200_000)).toBe('8.2 MB');
    expect(formatBytes(2_000_000_000)).toBe('2 GB');
  });
});

describe('sizeSummary', () => {
  it('splits the selection into known / unknown / pending / unprobed, never dropping a member', () => {
    const selected = new Set(['a', 'b', 'c', 'd', 'e']);
    const sizes = new Map<string, SizeEntry>([
      ['a', 1000],
      ['b', 500],
      ['c', 'unknown-length'],
      ['d', 'failed'],
    ]);
    const pending = new Set(['e']);
    const s = sizeSummary(selected, sizes, pending);
    expect(s).toEqual({ knownBytes: 1500, knownCount: 2, unknownCount: 2, pendingCount: 1, unprobedCount: 0 });
    expect(s.knownCount + s.unknownCount + s.pendingCount + s.unprobedCount).toBe(selected.size);
  });

  it('counts unprobed members separately from pending ones', () => {
    const s = sizeSummary(new Set(['x', 'y']), new Map(), new Set(['x']));
    expect(s.pendingCount).toBe(1);
    expect(s.unprobedCount).toBe(1);
  });
});

describe('selectRange (shift-click)', () => {
  const order = [
    img({ source: 'img', ext: 'png', id: 'A' }),
    img({ source: 'img', ext: 'png', id: 'B' }),
    img({ source: 'img', ext: 'png', id: 'C' }),
    img({ source: 'img', ext: 'png', id: 'D' }),
    img({ source: 'img', ext: 'png', id: 'E' }),
  ];

  it('selects the inclusive range between anchor and target', () => {
    expect([...selectRange(new Set(), order, 'B', 'D')].sort()).toEqual(['B', 'C', 'D']);
  });

  it('works regardless of click direction', () => {
    expect([...selectRange(new Set(), order, 'D', 'B')].sort()).toEqual(['B', 'C', 'D']);
  });

  it('adds to the existing selection, keeping ids outside the range', () => {
    expect([...selectRange(new Set(['A']), order, 'C', 'D')].sort()).toEqual(['A', 'C', 'D']);
  });

  it('ranges over the current order, so filtering out the middle excludes it', () => {
    const filtered = [order[0]!, order[2]!, order[4]!]; // A, C, E (B and D filtered away)
    expect([...selectRange(new Set(), filtered, 'A', 'E')].sort()).toEqual(['A', 'C', 'E']);
  });

  it('falls back to the target when the anchor is not in the order', () => {
    expect([...selectRange(new Set(), order, 'missing', 'C')]).toEqual(['C']);
  });
});

// The landing-page funnel: /tools/<variant> promises a subset, and the promise
// has to survive the click into /results. These are the parse rules that make
// the pre-applied filter honest — and, just as importantly, harmless when the
// link is wrong.
describe('parseFormatParam', () => {
  it('parses a single format', () => {
    expect([...parseFormatParam('png')]).toEqual(['png']);
  });

  it('parses a comma-separated list, deduped', () => {
    expect([...parseFormatParam('png,webp,png')].sort()).toEqual(['png', 'webp']);
  });

  it('is case- and whitespace-insensitive', () => {
    expect([...parseFormatParam('  PNG , WebP ')].sort()).toEqual(['png', 'webp']);
  });

  it('accepts jpg for jpeg — the spelling the UI shows and the copy will use', () => {
    expect([...parseFormatParam('jpg')]).toEqual(['jpeg']);
    expect([...parseFormatParam('jpeg')]).toEqual(['jpeg']);
  });

  it('accepts every canonical format, so no sidebar row is unreachable by link', () => {
    for (const ext of canonicalFormats()) {
      expect([...parseFormatParam(ext)]).toEqual([ext]);
    }
  });

  it('drops unrecognised values and keeps the rest', () => {
    expect([...parseFormatParam('png,tiff')]).toEqual(['png']);
  });

  it('yields an empty set (= no constraint) for absent, empty or all-bad input', () => {
    // A stale or mistyped link must show the whole grid, never an empty one.
    expect(parseFormatParam(null).size).toBe(0);
    expect(parseFormatParam('').size).toBe(0);
    expect(parseFormatParam(' , ').size).toBe(0);
    expect(parseFormatParam('tiff,bmp').size).toBe(0);
  });
});

describe('parseSourceParam', () => {
  it('accepts every source group id, so no bucket is unreachable by link', () => {
    for (const group of SOURCE_GROUPS) {
      expect([...parseSourceParam(group.id)]).toEqual([group.id]);
    }
  });

  it('parses a comma-separated list, case-insensitively', () => {
    expect([...parseSourceParam('css,META')].sort()).toEqual(['css', 'meta']);
  });

  it('yields an empty set for absent or unrecognised input', () => {
    expect(parseSourceParam(null).size).toBe(0);
    expect(parseSourceParam('nope').size).toBe(0);
  });

  it('does not accept a raw ImageSource — the param is the BUCKET vocabulary', () => {
    // 'favicon' is a raw source inside the 'meta' bucket. Accepting it here
    // would create a second, undocumented vocabulary for the same param.
    expect(parseSourceParam('favicon').size).toBe(0);
  });
});
