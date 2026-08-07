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

export type ImageSource =
  | 'img'
  | 'srcset'
  | 'picture'
  | 'css'
  | 'inline-svg'
  | 'meta'
  | 'poster'
  | 'favicon'
  | 'json-ld'
  | 'lazy'
  | 'object'
  | 'embed';

export interface ScanImage {
  id: string;
  url: string;
  filename: string;
  ext: ImageExt;
  source: ImageSource;
}

export interface ScanResult {
  pageUrl: string;
  images: ScanImage[];
  truncated: boolean;
  robotsBlocked?: true;
}

export interface RawCandidate {
  raw: string;
  source: ImageSource;
}

export interface HtmlExtraction {
  candidates: RawCandidate[];
  baseHref: string | null;
  stylesheetHrefs: string[];
  hitRawCap: boolean;
}

export const MAX_IMAGES = 1000;
export const MAX_STYLESHEETS = 3;
const MAX_RAW_CANDIDATES = 5000;
const MAX_STYLE_TEXT = 262_144;
const MAX_JSONLD_TEXT = 102_400;
const MAX_DATA_URI = 102_400;

const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-srcset', 'data-bg'];

const META_IMAGE_KEYS = new Set([
  'og:image',
  'og:image:url',
  'og:image:secure_url',
  'twitter:image',
  'twitter:image:src',
]);

/**
 * Comma-split srcset parsing. A data: URI inside srcset (legal, vanishingly
 * rare) would be mangled by the comma split; accepted limitation.
 */
export function parseSrcset(value: string): string[] {
  const urls: string[] = [];
  for (const part of value.split(',')) {
    const url = part.trim().split(/\s+/)[0];
    if (url) urls.push(url);
  }
  return urls;
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

function collectJsonLdImages(node: unknown, out: string[], depth: number): void {
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

function collectImageValue(value: unknown, out: string[], depth: number): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageValue(item, out, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    // ImageObject and friends
    const obj = value as Record<string, unknown>;
    for (const key of ['url', 'contentUrl']) {
      if (typeof obj[key] === 'string') out.push(obj[key] as string);
    }
  }
}

/** Streams the document through HTMLRewriter and collects raw candidates. */
export async function extractFromHtml(
  body: ReadableStream<Uint8Array> | string,
): Promise<HtmlExtraction> {
  const candidates: RawCandidate[] = [];
  const stylesheetHrefs: string[] = [];
  let baseHref: string | null = null;
  let hitRawCap = false;

  const addCandidate = (raw: string, source: ImageSource): void => {
    const trimmed = raw.trim();
    if (trimmed === '') return;
    if (candidates.length >= MAX_RAW_CANDIDATES) {
      hitRawCap = true;
      return;
    }
    candidates.push({ raw: trimmed, source });
  };

  // <style> text arrives in chunks; flush per text node.
  let styleBuf = '';
  let styleTotal = 0;

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
    .on('img', {
      element(el) {
        const src = el.getAttribute('src');
        if (src) addCandidate(src, 'img');
        const srcset = el.getAttribute('srcset');
        if (srcset) for (const url of parseSrcset(srcset)) addCandidate(url, 'srcset');
      },
    })
    .on('source', {
      element(el) {
        // srcset on <source> is only meaningful inside <picture>
        const srcset = el.getAttribute('srcset');
        if (srcset) for (const url of parseSrcset(srcset)) addCandidate(url, 'picture');
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
          addCandidate(href, 'favicon');
        }
      },
    })
    .on('meta', {
      element(el) {
        const key = (el.getAttribute('property') ?? el.getAttribute('name') ?? '').toLowerCase();
        if (!META_IMAGE_KEYS.has(key)) return;
        const content = el.getAttribute('content');
        if (content) addCandidate(content, 'meta');
      },
    })
    .on('[style]', {
      element(el) {
        const style = el.getAttribute('style');
        if (style && (style.includes('url(') || style.includes('image-set(')))
          for (const url of extractCssUrls(style)) addCandidate(url, 'css');
      },
    })
    .on('style', {
      text(chunk) {
        if (styleTotal < MAX_STYLE_TEXT) {
          styleBuf += chunk.text;
          styleTotal += chunk.text.length;
        }
        if (chunk.lastInTextNode) {
          for (const url of extractCssUrls(styleBuf)) addCandidate(url, 'css');
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
            const urls: string[] = [];
            collectJsonLdImages(parsed, urls, 0);
            for (const url of urls) addCandidate(url, 'json-ld');
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

  // The single most common way these tools under-report: lazy-loading
  // attributes live on <div>/<section>/<li> at least as often as on <img>,
  // so each selector is a bare [attr] matching any element.
  for (const attr of LAZY_ATTRS) {
    rewriter.on(`[${attr}]`, {
      element(el) {
        const value = el.getAttribute(attr);
        if (!value) return;
        if (attr === 'data-srcset') {
          for (const url of parseSrcset(value)) addCandidate(url, 'lazy');
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

function sanitizeFilename(name: string): string {
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
  /** True when upstream truncated the HTML or the raw-candidate cap was hit. */
  truncatedHint?: boolean;
}

export function finalizeManifest(input: FinalizeInput): { images: ScanImage[]; truncated: boolean } {
  const base = resolveDocumentBase(input.baseHref, input.pageUrl);
  const seen = new Set<string>();
  const usedFilenames = new Map<string, number>();
  let inlineCount = 0;
  const inlineCounter = (): number => ++inlineCount;
  const images: ScanImage[] = [];
  let truncated = input.truncatedHint === true;

  for (const candidate of input.candidates) {
    const resolved = resolveCandidate(candidate.raw, base);
    if (resolved === null || seen.has(resolved)) continue;
    seen.add(resolved);
    if (images.length >= MAX_IMAGES) {
      truncated = true;
      break;
    }
    const ext = resolved.startsWith('data:')
      ? extFromDataUri(resolved)
      : extFromPathname(new URL(resolved).pathname);
    images.push({
      id: fnv1a64(resolved),
      url: resolved,
      filename: uniqueFilename(filenameForUrl(resolved, ext, inlineCounter), usedFilenames),
      ext,
      source: candidate.source,
    });
  }
  return { images, truncated };
}
