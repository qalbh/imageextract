/**
 * Streaming image-URL extraction via HTMLRewriter.
 *
 * Nothing is resolved during the stream: handlers only collect raw attribute
 * values, and resolution happens once at end-of-document against the first
 * `<base href>` (HTML honors only the first). Deferring resolution is what
 * makes <base> position irrelevant despite streaming — candidates are held
 * in memory for dedupe anyway, so it costs nothing. Known divergence: a
 * browser resolves subresources incrementally, so an <img> appearing BEFORE
 * the <base> uses the pre-base URL; we apply the base to everything. Only
 * pathological HTML differs.
 */

export type ImageExt = 'png' | 'jpeg' | 'svg' | 'gif' | 'webp' | 'avif' | 'ico' | 'unknown';

// Canonical list — the ImageSource type and the AGENTS.md manifest snippet
// both derive from it (a doc-sync test enforces the latter). The three
// style-ish variants stay distinct because they resolve against different
// bases and fail in different ways: style-attr and style-block resolve
// against the document base; stylesheet resolves against the sheet's own
// URL and can be missing entirely when a sheet fetch fails.
export const IMAGE_SOURCES = [
  'img',
  'srcset',
  'picture',
  'style-attr',
  'style-block',
  'stylesheet',
  'inline-svg',
  'meta',
  'poster',
  'favicon',
  'json-ld',
  'lazy',
  'object',
  'embed',
] as const;
export type ImageSource = (typeof IMAGE_SOURCES)[number];

// Declared dimensions come from the page's own markup (free, from bytes we
// already stream); they are unverified — pages go stale and lie — so the UI
// distinguishes them from measured ones and renders declared values muted.
// The extractor only ever emits 'declared'; the client flips to 'measured'
// once naturalWidth is known.
export const DIMENSION_SOURCES = ['declared', 'measured'] as const;
export type DimensionSource = (typeof DIMENSION_SOURCES)[number];

export interface ScanImage {
  id: string;
  url: string;
  filename: string;
  ext: ImageExt;
  source: ImageSource;
  width?: number;
  height?: number;
  dimensionSource?: DimensionSource;
  // Shared id for every candidate of one logical image — a whole <picture>
  // (all its <source>s plus the fallback <img>) or a standalone <img>'s
  // src+srcset. The UI to collapse variants is deferred; see AGENTS.md.
  variantGroup?: string;
}

// 'image-cap': the whole page was parsed but the list was trimmed at the
// image cap. 'size-cap': part of the page was never parsed, so images may be
// missing entirely — which is why size-cap wins when both fire.
export const TRUNCATION_REASONS = ['image-cap', 'size-cap'] as const;
export type TruncationReason = (typeof TRUNCATION_REASONS)[number];

export interface ScanResult {
  pageUrl: string;
  images: ScanImage[];
  truncated?: TruncationReason;
  robotsBlocked?: true;
}

export interface RawCandidate {
  raw: string;
  source: ImageSource;
  width?: number;
  height?: number;
  variantGroup?: string;
}

export interface HtmlExtraction {
  candidates: RawCandidate[];
  baseHref: string | null;
  stylesheetHrefs: string[];
  hitRawCap: boolean;
}

// MAX_IMAGES counts LOGICAL images (variant sets count once, see
// finalizeManifest); the absolute ceiling on manifest ENTRIES is therefore
// MAX_RAW_CANDIDATES — a transfer-size bound, not a rendering one (the
// results UI mounts 120 tiles regardless).
export const MAX_IMAGES = 1000;
export const MAX_STYLESHEETS = 3;
export const MAX_RAW_CANDIDATES = 5000;
const MAX_STYLE_TEXT = 262_144;
const MAX_JSONLD_TEXT = 102_400;
const MAX_DATA_URI = 102_400;
// Bounds our buffered copy of <noscript> content (the 5 MB HTML cap already
// bounds the bytes themselves — noscript is inside the same document, so
// parsing it adds work, not transfer). Overflow drops silently, same policy
// as MAX_STYLE_TEXT.
export const MAX_NOSCRIPT_TEXT = 1_048_576;

const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-srcset', 'data-bg'];

const META_IMAGE_KEYS = new Set([
  'og:image',
  'og:image:url',
  'og:image:secure_url',
  'twitter:image',
  'twitter:image:src',
]);

export interface SrcsetEntry {
  url: string;
  /** The `w` descriptor if present ("800w" → 800). Density ("2x") yields none. */
  width?: number;
}

/**
 * Comma-split srcset parsing, returning each candidate with its `w` descriptor
 * width. A data: URI inside srcset (legal, vanishingly rare) would be mangled
 * by the comma split; accepted limitation.
 */
export function parseSrcset(value: string): SrcsetEntry[] {
  const entries: SrcsetEntry[] = [];
  for (const part of value.split(',')) {
    const tokens = part.trim().split(/\s+/);
    const url = tokens[0];
    if (!url) continue;
    let width: number | undefined;
    for (const d of tokens.slice(1)) {
      const m = /^(\d+)w$/.exec(d);
      if (m) width = parseInt(m[1] as string, 10);
    }
    entries.push(width !== undefined ? { url, width } : { url });
  }
  return entries;
}

/** Parse a declared dimension: integer, "1920px", or a JSON-LD number/string. */
function coerceDim(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;
  if (typeof v === 'string') {
    const m = /^\s*(\d+)/.exec(v);
    if (m) {
      const n = parseInt(m[1] as string, 10);
      if (n > 0) return n;
    }
  }
  return undefined;
}

const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]+))\s*\)/gi;
const IMAGE_SET_RE = /(?:-webkit-)?image-set\(([^)]*)\)/gi;
const QUOTED_RE = /"([^"]+)"|'([^']+)'/g;

/**
 * url(...) everywhere plus bare quoted strings inside image-set(...). An
 * image-set argument list containing url() forms is cut short by the first
 * closing paren, but those url() entries are caught by the global pass.
 */
export function extractCssUrls(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(CSS_URL_RE)) {
    const url = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (url) out.push(url);
  }
  for (const set of css.matchAll(IMAGE_SET_RE)) {
    for (const q of (set[1] ?? '').matchAll(QUOTED_RE)) {
      const url = (q[1] ?? q[2] ?? '').trim();
      if (url) out.push(url);
    }
  }
  return out;
}

// HTML tokenization lowercases attribute names; browsers restore SVG's
// camelCase via the spec's "adjust SVG attributes" table when building the
// tree. We serialize from tokens, so we apply the same table — without it,
// viewBox et al. are silently dropped by the strict XML parser that reads
// our data: URI.
const SVG_ATTR_CASE: Record<string, string> = Object.fromEntries(
  [
    'attributeName', 'attributeType', 'baseFrequency', 'baseProfile', 'calcMode',
    'clipPathUnits', 'diffuseConstant', 'edgeMode', 'filterUnits', 'glyphRef',
    'gradientTransform', 'gradientUnits', 'kernelMatrix', 'kernelUnitLength',
    'keyPoints', 'keySplines', 'keyTimes', 'lengthAdjust', 'limitingConeAngle',
    'markerHeight', 'markerUnits', 'markerWidth', 'maskContentUnits', 'maskUnits',
    'numOctaves', 'pathLength', 'patternContentUnits', 'patternTransform',
    'patternUnits', 'pointsAtX', 'pointsAtY', 'pointsAtZ', 'preserveAlpha',
    'preserveAspectRatio', 'primitiveUnits', 'refX', 'refY', 'repeatCount',
    'repeatDur', 'requiredExtensions', 'requiredFeatures', 'specularConstant',
    'specularExponent', 'spreadMethod', 'startOffset', 'stdDeviation',
    'surfaceScale', 'systemLanguage', 'tableValues', 'targetX', 'targetY',
    'textLength', 'viewBox', 'viewTarget', 'xChannelSelector', 'yChannelSelector',
    'zoomAndPan',
  ].map((name) => [name.toLowerCase(), name]),
);

const SVG_XMLNS = 'http://www.w3.org/2000/svg';

function escapeXmlText(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

function escapeXmlAttr(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

interface JsonLdImage {
  url: string;
  width?: number;
  height?: number;
}

function collectJsonLdImages(node: unknown, out: JsonLdImage[], depth: number): void {
  if (depth > 8 || node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdImages(item, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'image') collectImageValue(value, out, depth + 1);
    else if (typeof value === 'object') collectJsonLdImages(value, out, depth + 1);
  }
}

function collectImageValue(value: unknown, out: JsonLdImage[], depth: number): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    out.push({ url: value });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageValue(item, out, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    // ImageObject and friends — carry declared width/height when present.
    const obj = value as Record<string, unknown>;
    const width = coerceDim(obj.width);
    const height = coerceDim(obj.height);
    for (const key of ['url', 'contentUrl']) {
      if (typeof obj[key] === 'string') {
        const img: JsonLdImage = { url: obj[key] as string };
        if (width !== undefined) img.width = width;
        if (height !== undefined) img.height = height;
        out.push(img);
      }
    }
  }
}

/**
 * Streams the document through HTMLRewriter and collects raw candidates.
 *
 * `depth` is internal: <noscript> fragments re-enter this same function
 * (depth 1) so they go through the identical pipeline with zero duplicated
 * handler logic. Fragment passes do not collect noscript again — nested
 * noscript is invalid HTML, and the guard makes non-recursion explicit
 * rather than accidental.
 */
export async function extractFromHtml(
  body: ReadableStream<Uint8Array> | string,
  depth = 0,
): Promise<HtmlExtraction> {
  const candidates: RawCandidate[] = [];
  const stylesheetHrefs: string[] = [];
  let baseHref: string | null = null;
  let hitRawCap = false;

  interface CandidateDims {
    width?: number;
    height?: number;
    variantGroup?: string;
  }
  // Returns the pushed candidate so callers can attach dimensions that arrive
  // in later elements (og:image:width/height follow og:image).
  const addCandidate = (
    raw: string,
    source: ImageSource,
    dims?: CandidateDims,
  ): RawCandidate | undefined => {
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    if (candidates.length >= MAX_RAW_CANDIDATES) {
      hitRawCap = true;
      return undefined;
    }
    const candidate: RawCandidate = { raw: trimmed, source };
    if (dims) {
      if (dims.width !== undefined) candidate.width = dims.width;
      if (dims.height !== undefined) candidate.height = dims.height;
      if (dims.variantGroup !== undefined) candidate.variantGroup = dims.variantGroup;
    }
    candidates.push(candidate);
    return candidate;
  };

  // Integer width/height attribute (rejects percentages, "auto", 0).
  const intAttr = (el: Element, name: string): number | undefined => {
    const v = el.getAttribute(name);
    if (v && /^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      if (n > 0) return n;
    }
    return undefined;
  };

  // variantGroup id per logical image (a <picture> block, or a standalone
  // <img>'s src+srcset). pictureGroup holds the current <picture>'s group so
  // its <source>s and fallback <img> share one id.
  let variantSeq = 0;
  const nextGroup = (): string => `vg-${++variantSeq}`;
  let pictureGroup: string | null = null;

  // The last og:image candidate, so trailing og:image:width/height attach.
  let lastOgImage: RawCandidate | undefined;

  // <style> text arrives in chunks; flush per text node.
  let styleBuf = '';
  let styleTotal = 0;

  // <noscript> content is the site's own answer to non-JS user agents —
  // which is exactly what this scanner is. HTMLRewriter parses with
  // scripting assumed ON, so that content arrives here as raw TEXT and no
  // element handler ever fires inside it (measured: half of apple.com's
  // rendered images existed statically only in noscript). Collect the
  // fragments; they re-enter this pipeline after the main drain.
  let noscriptBuf = '';
  let noscriptTotal = 0;
  const noscriptFragments: string[] = [];

  // <script type="application/ld+json"> — element handler flags, text
  // handler accumulates. Streaming is sequential, so one flag suffices.
  let inJsonLd = false;
  let jsonLdBuf = '';

  // Inline <svg> serialization state. Start tags are emitted as they stream
  // by; end tags via onEndTag callbacks, which throw synchronously for
  // self-closing foreign elements ("no end tag") — that throw is our
  // self-closing detector.
  let svgParts: string[] | null = null;
  let svgLength = 0;
  let svgOverflow = false;
  const pushSvg = (piece: string): void => {
    if (svgParts === null || svgOverflow) return;
    svgLength += piece.length;
    if (svgLength > MAX_DATA_URI) {
      svgOverflow = true;
      return;
    }
    svgParts.push(piece);
  };
  const finishSvg = (): void => {
    if (svgParts !== null && !svgOverflow) {
      const markup = svgParts.join('');
      const uri = `data:image/svg+xml,${encodeURIComponent(markup)}`;
      if (uri.length <= MAX_DATA_URI) addCandidate(uri, 'inline-svg');
    }
    svgParts = null;
    svgLength = 0;
    svgOverflow = false;
  };
  const serializeElement = (el: Element): void => {
    const isRoot = svgLength === 0;
    let attrs = '';
    let hasXmlns = false;
    // Two globals named Element exist (DOM lib and the Workers runtime
    // types); skipLibCheck lets the DOM one win, so name the runtime's
    // iterator shape explicitly.
    const attributePairs = el.attributes as unknown as IterableIterator<[string, string]>;
    for (const [name, value] of attributePairs) {
      if (name === 'xmlns') hasXmlns = true;
      attrs += ` ${SVG_ATTR_CASE[name] ?? name}="${escapeXmlAttr(value ?? '')}"`;
    }
    // Inline SVG in HTML needs no namespace; a standalone image/svg+xml
    // document does, or nothing renders.
    if (isRoot && !hasXmlns) attrs += ` xmlns="${SVG_XMLNS}"`;
    let selfClosing = false;
    try {
      el.onEndTag((end) => {
        pushSvg(`</${end.name}>`);
        if (isRoot) finishSvg();
      });
    } catch {
      selfClosing = true;
    }
    pushSvg(`<${el.tagName}${attrs}${selfClosing ? '/>' : '>'}`);
    // A self-closing root (<svg/>) never gets an end-tag callback.
    if (selfClosing && isRoot) finishSvg();
  };

  const rewriter = new HTMLRewriter()
    .on('base', {
      element(el) {
        if (baseHref === null) {
          const href = el.getAttribute('href');
          if (href) baseHref = href;
        }
      },
    })
    .on('picture', {
      element(el) {
        // Every candidate inside one <picture> — all <source>s and the
        // fallback <img> — is one logical image, so they share a group.
        pictureGroup = nextGroup();
        try {
          el.onEndTag(() => {
            pictureGroup = null;
          });
        } catch {
          pictureGroup = null; // self-closing <picture> shouldn't happen
        }
      },
    })
    .on('img', {
      element(el) {
        const w = intAttr(el, 'width');
        const h = intAttr(el, 'height');
        const src = el.getAttribute('src');
        const srcset = el.getAttribute('srcset');
        // Inside a <picture> the img joins that group; a standalone img with a
        // srcset gets its own; a lone src has no group (it's one image).
        const group = pictureGroup ?? (srcset ? nextGroup() : undefined);
        if (src) addCandidate(src, 'img', { width: w, height: h, variantGroup: group });
        if (srcset) {
          for (const { url, width } of parseSrcset(srcset)) {
            // A `w` descriptor gives width only. When the img declares both
            // width and height, its aspect ratio transfers to every scale of
            // the same image, so height = width ÷ (declaredW / declaredH).
            const height =
              width !== undefined && w !== undefined && h !== undefined
                ? Math.round((width * h) / w)
                : undefined;
            addCandidate(url, 'srcset', { width, height, variantGroup: group });
          }
        }
      },
    })
    .on('source', {
      element(el) {
        // srcset on <source> is only meaningful inside <picture>.
        const srcset = el.getAttribute('srcset');
        if (!srcset) return;
        const group = pictureGroup ?? nextGroup();
        // <source> candidates are WIDTH-ONLY on purpose: the sibling <img>'s
        // declared aspect ratio isn't available in a streaming pass — the
        // <img> comes after the <source>s — so no height can be derived here.
        // This is a known limitation, not a gap to fix later; and because
        // <picture> is where responsive images cluster, this is exactly where
        // dimension coverage is thinnest.
        for (const { url, width } of parseSrcset(srcset)) {
          addCandidate(url, 'picture', { width, variantGroup: group });
        }
      },
    })
    .on('video', {
      element(el) {
        const poster = el.getAttribute('poster');
        if (poster) addCandidate(poster, 'poster');
      },
    })
    .on('object', {
      element(el) {
        const data = el.getAttribute('data');
        if (data) addCandidate(data, 'object');
      },
    })
    .on('embed', {
      element(el) {
        const src = el.getAttribute('src');
        if (src) addCandidate(src, 'embed');
      },
    })
    .on('link', {
      element(el) {
        const href = el.getAttribute('href');
        if (!href) return;
        const rel = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
        if (rel.includes('stylesheet')) {
          if (stylesheetHrefs.length < MAX_STYLESHEETS) stylesheetHrefs.push(href);
        } else if (
          rel.includes('icon') ||
          rel.includes('apple-touch-icon') ||
          rel.includes('apple-touch-icon-precomposed')
        ) {
          const candidate = addCandidate(href, 'favicon');
          // link[sizes]="32x32" (first WxH; "any" won't match).
          const sizes = el.getAttribute('sizes');
          const m = sizes ? /(\d+)x(\d+)/i.exec(sizes) : null;
          if (candidate && m) {
            candidate.width = parseInt(m[1] as string, 10);
            candidate.height = parseInt(m[2] as string, 10);
          }
        }
      },
    })
    .on('meta', {
      element(el) {
        const key = (el.getAttribute('property') ?? el.getAttribute('name') ?? '').toLowerCase();
        if (META_IMAGE_KEYS.has(key)) {
          const content = el.getAttribute('content');
          const candidate = content ? addCandidate(content, 'meta') : undefined;
          // og:image:width/height that follow attach to an og:image; twitter
          // has no standard dimension metas, so only track og:image*.
          lastOgImage = key.startsWith('og:image') ? candidate : undefined;
          return;
        }
        if ((key === 'og:image:width' || key === 'og:image:height') && lastOgImage) {
          const v = coerceDim(el.getAttribute('content'));
          if (v !== undefined) {
            if (key.endsWith('width')) lastOgImage.width = v;
            else lastOgImage.height = v;
          }
        }
      },
    })
    .on('[style]', {
      element(el) {
        const style = el.getAttribute('style');
        if (style && (style.includes('url(') || style.includes('image-set(')))
          for (const url of extractCssUrls(style)) addCandidate(url, 'style-attr');
      },
    })
    .on('style', {
      text(chunk) {
        if (styleTotal < MAX_STYLE_TEXT) {
          styleBuf += chunk.text;
          styleTotal += chunk.text.length;
        }
        if (chunk.lastInTextNode) {
          for (const url of extractCssUrls(styleBuf)) addCandidate(url, 'style-block');
          styleBuf = '';
        }
      },
    })
    .on('script', {
      element(el) {
        inJsonLd = (el.getAttribute('type') ?? '').toLowerCase().includes('ld+json');
        jsonLdBuf = '';
      },
      text(chunk) {
        if (!inJsonLd) return;
        if (jsonLdBuf.length < MAX_JSONLD_TEXT) jsonLdBuf += chunk.text;
        if (chunk.lastInTextNode) {
          try {
            const parsed: unknown = JSON.parse(jsonLdBuf);
            const found: JsonLdImage[] = [];
            collectJsonLdImages(parsed, found, 0);
            for (const img of found)
              addCandidate(img.url, 'json-ld', { width: img.width, height: img.height });
          } catch {
            // Malformed JSON-LD is the page's problem, not ours.
          }
          jsonLdBuf = '';
        }
      },
    })
    .on('svg', {
      element(el) {
        if (svgParts !== null) return; // nested <svg>: the 'svg *' handler emits it
        svgParts = [];
        serializeElement(el);
      },
      // Text handlers receive all text within the matched element's subtree,
      // so registering here (and not on 'svg *') captures each chunk once.
      text(chunk) {
        if (chunk.text) pushSvg(escapeXmlText(chunk.text));
      },
    })
    .on('svg *', {
      element(el) {
        if (svgParts !== null) serializeElement(el);
      },
    });

  if (depth === 0) {
    rewriter.on('noscript', {
      text(chunk) {
        // Hard cap: a string body arrives as one big chunk, so the append
        // itself must be sliced — a soft threshold check would admit the
        // whole document in a single chunk. A mid-markup cut leaves a
        // dangling tag that parses to nothing, which is the silent-drop
        // policy working as intended.
        if (noscriptTotal < MAX_NOSCRIPT_TEXT) {
          const room = MAX_NOSCRIPT_TEXT - noscriptTotal;
          noscriptBuf += chunk.text.length > room ? chunk.text.slice(0, room) : chunk.text;
        }
        noscriptTotal += chunk.text.length;
        if (chunk.lastInTextNode) {
          if (noscriptBuf.trim() !== '') noscriptFragments.push(noscriptBuf);
          noscriptBuf = '';
        }
      },
    });
  }

  // The single most common way these tools under-report: lazy-loading
  // attributes live on <div>/<section>/<li> at least as often as on <img>,
  // so each selector is a bare [attr] matching any element.
  for (const attr of LAZY_ATTRS) {
    rewriter.on(`[${attr}]`, {
      element(el) {
        const value = el.getAttribute(attr);
        if (!value) return;
        if (attr === 'data-srcset') {
          const w = intAttr(el, 'width');
          const h = intAttr(el, 'height');
          const group = pictureGroup ?? nextGroup();
          for (const { url, width } of parseSrcset(value)) {
            const height =
              width !== undefined && w !== undefined && h !== undefined
                ? Math.round((width * h) / w)
                : undefined;
            addCandidate(url, 'lazy', { width, height, variantGroup: group });
          }
        } else if (value.includes('url(')) {
          // data-bg is often a whole CSS value, not a bare URL
          for (const url of extractCssUrls(value)) addCandidate(url, 'lazy');
        } else {
          addCandidate(value, 'lazy');
        }
      },
    });
  }

  const transformed = rewriter.transform(new Response(body));
  // Drain without accumulating — we only want the handlers' side effects.
  const reader = transformed.body?.getReader();
  if (reader) {
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
  }

  // A size-capped document can end mid-noscript without a final
  // lastInTextNode; flush the residue rather than lose it.
  if (noscriptBuf.trim() !== '') noscriptFragments.push(noscriptBuf);

  // Noscript fragments re-enter the identical pipeline. Merge rules:
  // candidates append AFTER the document's (so first-wins dedupe in
  // finalizeManifest lets a markup occurrence beat its noscript duplicate),
  // under the parent's raw-candidate budget; child variantGroups are
  // namespaced — each fragment pass restarts its counter at vg-1, and an
  // unremapped id would merge a noscript <picture> into an unrelated markup
  // group, corrupting the logical-image cap; a child <base> is discarded
  // (dead in every scripting-on browser — the document base governs);
  // stylesheet hrefs merge under the same shared cap of MAX_STYLESHEETS.
  for (let i = 0; i < noscriptFragments.length; i++) {
    const fragment = await extractFromHtml(noscriptFragments[i] as string, 1);
    for (const c of fragment.candidates) {
      if (candidates.length >= MAX_RAW_CANDIDATES) {
        hitRawCap = true;
        break;
      }
      if (c.variantGroup !== undefined) c.variantGroup = `n${i}-${c.variantGroup}`;
      candidates.push(c);
    }
    if (fragment.hitRawCap) hitRawCap = true;
    for (const href of fragment.stylesheetHrefs) {
      if (stylesheetHrefs.length < MAX_STYLESHEETS) stylesheetHrefs.push(href);
    }
  }

  return { candidates, baseHref, stylesheetHrefs, hitRawCap };
}

export function resolveDocumentBase(baseHref: string | null, pageUrl: URL): URL {
  if (baseHref !== null) {
    try {
      return new URL(baseHref, pageUrl);
    } catch {
      // Fall through: an unparseable base is ignored, like browsers do.
    }
  }
  return pageUrl;
}

const EXT_BY_SUFFIX: Record<string, ImageExt> = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  jfif: 'jpeg',
  svg: 'svg',
  gif: 'gif',
  webp: 'webp',
  avif: 'avif',
  ico: 'ico',
};

const EXT_BY_MIME: Record<string, ImageExt> = {
  png: 'png',
  jpeg: 'jpeg',
  jpg: 'jpeg',
  'svg+xml': 'svg',
  gif: 'gif',
  webp: 'webp',
  avif: 'avif',
  'x-icon': 'ico',
  'vnd.microsoft.icon': 'ico',
};

function extFromPathname(pathname: string): ImageExt {
  const match = /\.([a-z0-9]+)$/i.exec(pathname);
  return EXT_BY_SUFFIX[match?.[1]?.toLowerCase() ?? ''] ?? 'unknown';
}

function extFromDataUri(uri: string): ImageExt {
  const match = /^data:image\/([a-z0-9.+-]+)[;,]/i.exec(uri);
  return EXT_BY_MIME[match?.[1]?.toLowerCase() ?? ''] ?? 'unknown';
}

export function sanitizeFilename(name: string): string {
  let out = name
    .replace(/[/\\]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '');
  if (out.length > 80) {
    const dot = out.lastIndexOf('.');
    const suffix = dot > 0 && out.length - dot <= 10 ? out.slice(dot) : '';
    out = out.slice(0, 80 - suffix.length) + suffix;
  }
  return out;
}

function filenameForUrl(url: string, ext: ImageExt, inlineCounter: () => number): string {
  if (url.startsWith('data:')) {
    return `inline-${inlineCounter()}${ext !== 'unknown' ? `.${extSuffix(ext)}` : ''}`;
  }
  let name = '';
  try {
    name = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
  } catch {
    // absolute URLs only reach here; fall through to the fallback name
  }
  try {
    name = decodeURIComponent(name);
  } catch {
    // %-sequence that isn't valid UTF-8 — keep the encoded form
  }
  name = sanitizeFilename(name);
  if (name === '') name = `image${ext !== 'unknown' ? `.${extSuffix(ext)}` : ''}`;
  return name;
}

function extSuffix(ext: ImageExt): string {
  return ext === 'jpeg' ? 'jpg' : ext;
}

function uniqueFilename(name: string, used: Map<string, number>): string {
  const key = name.toLowerCase();
  const count = used.get(key) ?? 0;
  used.set(key, count + 1);
  if (count === 0) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}-${count + 1}${name.slice(dot)}` : `${name}-${count + 1}`;
}

function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Resolve a raw candidate to an absolute http(s) URL (normalized: fragment
 * stripped, query params sorted) or an accepted data: URI. Returns null for
 * anything else — javascript:, blob:, oversized or non-image data:, garbage.
 */
function resolveCandidate(raw: string, base: URL): string | null {
  if (raw.startsWith('data:')) {
    if (!/^data:image\//i.test(raw)) return null;
    if (raw.length > MAX_DATA_URI) return null;
    return raw;
  }
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.searchParams.sort();
  return url.href;
}

export interface FinalizeInput {
  pageUrl: URL;
  baseHref: string | null;
  candidates: RawCandidate[];
  /** The HTML byte cap cut the document short. */
  sizeCapHit?: boolean;
  /** The raw-candidate cap dropped collection partway — reported as image-cap. */
  volumeCapHit?: boolean;
}

export function finalizeManifest(input: FinalizeInput): {
  images: ScanImage[];
  truncated: TruncationReason | undefined;
} {
  const base = resolveDocumentBase(input.baseHref, input.pageUrl);
  const seen = new Set<string>();
  const usedFilenames = new Map<string, number>();
  let inlineCount = 0;
  const inlineCounter = (): number => ++inlineCount;
  const images: ScanImage[] = [];
  let imageCapHit = input.volumeCapHit === true;

  // MAX_IMAGES counts LOGICAL images, not candidates: a grouped candidate's
  // unit is its variantGroup; an ungrouped one (lone <img src>, favicon,
  // CSS url — one image, no group) is its own unit, keyed by URL. A page of
  // 375 products × 8 srcset widths is 375 units, not 3,000 — measured on a
  // live Shopify collection, candidate counting exhausted the cap at ~125
  // products while the served HTML held 2,998 image URLs the parser had
  // already read. Admission: variants of an admitted unit are free (an
  // admitted logical image never loses variants; a rejected one drops
  // whole), so the loop must CONTINUE past the cap, not break — later
  // candidates can belong to admitted units. Entry count is therefore
  // bounded by MAX_RAW_CANDIDATES, not MAX_IMAGES.
  const units = new Set<string>();

  for (const candidate of input.candidates) {
    const resolved = resolveCandidate(candidate.raw, base);
    if (resolved === null || seen.has(resolved)) continue;
    seen.add(resolved);
    const unit =
      candidate.variantGroup !== undefined ? `g:${candidate.variantGroup}` : `u:${resolved}`;
    if (!units.has(unit)) {
      if (units.size >= MAX_IMAGES) {
        imageCapHit = true;
        continue;
      }
      units.add(unit);
    }
    const ext = resolved.startsWith('data:')
      ? extFromDataUri(resolved)
      : extFromPathname(new URL(resolved).pathname);
    // First-wins: `seen` skips later duplicates of this URL, so the first
    // candidate's declared dimensions are the ones kept.
    const image: ScanImage = {
      id: fnv1a64(resolved),
      url: resolved,
      filename: uniqueFilename(filenameForUrl(resolved, ext, inlineCounter), usedFilenames),
      ext,
      source: candidate.source,
    };
    if (candidate.width !== undefined) image.width = candidate.width;
    if (candidate.height !== undefined) image.height = candidate.height;
    if (candidate.width !== undefined || candidate.height !== undefined) {
      image.dimensionSource = 'declared';
    }
    if (candidate.variantGroup !== undefined) image.variantGroup = candidate.variantGroup;
    images.push(image);
  }
  const truncated: TruncationReason | undefined = input.sizeCapHit
    ? 'size-cap'
    : imageCapHit
      ? 'image-cap'
      : undefined;
  return { images, truncated };
}
