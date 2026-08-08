import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGES,
  extractCssUrls,
  extractFromHtml,
  finalizeManifest,
  parseSrcset,
  type ScanImage,
  type TruncationReason,
} from './extract';

const PAGE = new URL('https://site.example/articles/post/');

async function scan(
  html: string,
): Promise<{ images: ScanImage[]; truncated: TruncationReason | undefined }> {
  const extraction = await extractFromHtml(html);
  return finalizeManifest({
    pageUrl: PAGE,
    baseHref: extraction.baseHref,
    candidates: extraction.candidates,
    volumeCapHit: extraction.hitRawCap,
  });
}

function urls(images: ScanImage[]): string[] {
  return images.map((i) => i.url);
}

describe('parseSrcset', () => {
  it('extracts URLs and drops descriptors', () => {
    expect(parseSrcset('a.jpg 480w, b.jpg 800w')).toEqual(['a.jpg', 'b.jpg']);
    expect(parseSrcset('a.jpg 1x,b.jpg 2x')).toEqual(['a.jpg', 'b.jpg']);
    expect(parseSrcset('  solo.png  ')).toEqual(['solo.png']);
    expect(parseSrcset('a.jpg 1x,, ,b.jpg')).toEqual(['a.jpg', 'b.jpg']);
  });
});

describe('extractCssUrls', () => {
  it('handles quoted, unquoted, and image-set forms', () => {
    expect(extractCssUrls('background:url(a.png)')).toEqual(['a.png']);
    expect(extractCssUrls("background:url('b.png')")).toEqual(['b.png']);
    expect(extractCssUrls('background:url( "c.png" )')).toEqual(['c.png']);
    expect(extractCssUrls('background:image-set("d.png" 1x, "e.png" 2x)')).toEqual([
      'd.png',
      'e.png',
    ]);
    expect(extractCssUrls('background:-webkit-image-set(url(f.png) 1x)')).toEqual(['f.png']);
  });
});

describe('extractFromHtml + finalizeManifest', () => {
  it('produces the full manifest shape', async () => {
    const { images, truncated } = await scan('<img src="/pics/cat photo.jpg">');
    expect(truncated).toBeUndefined();
    expect(images).toHaveLength(1);
    const image = images[0] as ScanImage;
    expect(image.url).toBe('https://site.example/pics/cat%20photo.jpg');
    expect(image.filename).toBe('cat photo.jpg');
    expect(image.ext).toBe('jpeg');
    expect(image.source).toBe('img');
    expect(image.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('resolves relative URLs against the page URL when there is no base', async () => {
    const { images } = await scan('<img src="img/a.png"><img src="../b.png"><img src="/c.png">');
    expect(urls(images)).toEqual([
      'https://site.example/articles/post/img/a.png',
      'https://site.example/articles/b.png',
      'https://site.example/c.png',
    ]);
  });

  it('applies <base href> that appears AFTER the elements that depend on it', async () => {
    const html = '<img src="early.png"><base href="https://cdn.example/assets/"><img src="late.png">';
    const { images } = await scan(html);
    expect(urls(images)).toEqual([
      'https://cdn.example/assets/early.png',
      'https://cdn.example/assets/late.png',
    ]);
  });

  it('honors only the first <base>', async () => {
    const html =
      '<base href="https://first.example/"><base href="https://second.example/"><img src="x.png">';
    const { images } = await scan(html);
    expect(urls(images)).toEqual(['https://first.example/x.png']);
  });

  it('ignores an unparseable base', async () => {
    const { images } = await scan('<base href="http://"><img src="x.png">');
    expect(urls(images)).toEqual(['https://site.example/articles/post/x.png']);
  });

  it('collects lazy attributes on non-img elements', async () => {
    const html = [
      '<div data-src="/lazy/div.jpg"></div>',
      '<section data-lazy-src="/lazy/section.png"></section>',
      '<div data-original="/lazy/original.webp"></div>',
      '<li data-bg="url(/lazy/bg.png)"></li>',
      '<div data-srcset="/lazy/a.jpg 1x, /lazy/b.jpg 2x"></div>',
    ].join('');
    const { images } = await scan(html);
    expect(urls(images)).toEqual([
      'https://site.example/lazy/div.jpg',
      'https://site.example/lazy/section.png',
      'https://site.example/lazy/original.webp',
      'https://site.example/lazy/bg.png',
      'https://site.example/lazy/a.jpg',
      'https://site.example/lazy/b.jpg',
    ]);
    expect(images.every((i) => i.source === 'lazy')).toBe(true);
  });

  it('parses img srcset alongside src', async () => {
    const { images } = await scan('<img src="a.png" srcset="b.png 480w, c.png 800w">');
    expect(urls(images)).toEqual([
      'https://site.example/articles/post/a.png',
      'https://site.example/articles/post/b.png',
      'https://site.example/articles/post/c.png',
    ]);
    expect(images.map((i) => i.source)).toEqual(['img', 'srcset', 'srcset']);
  });

  it('collects picture sources', async () => {
    const html =
      '<picture><source srcset="/p/a.webp 1x, /p/b.webp 2x" type="image/webp"><img src="/p/fallback.jpg"></picture>';
    const { images } = await scan(html);
    expect(urls(images)).toContain('https://site.example/p/a.webp');
    expect(urls(images)).toContain('https://site.example/p/fallback.jpg');
    expect(images.find((i) => i.url.endsWith('a.webp'))?.source).toBe('picture');
  });

  it('dedupes by normalized URL: fragments stripped, query params sorted', async () => {
    const html = [
      '<img src="/a.png#top">',
      '<img src="/a.png">',
      '<img src="/b.png?z=1&a=2">',
      '<img src="/b.png?a=2&z=1">',
    ].join('');
    const { images } = await scan(html);
    expect(urls(images)).toEqual([
      'https://site.example/a.png',
      'https://site.example/b.png?a=2&z=1',
    ]);
  });

  it('suffixes duplicate filenames', async () => {
    const { images } = await scan('<img src="/x/pic.png"><img src="/y/pic.png">');
    expect(images.map((i) => i.filename)).toEqual(['pic.png', 'pic-2.png']);
  });

  it(`caps at ${MAX_IMAGES} images and reports image-cap`, async () => {
    const tags = Array.from({ length: 1200 }, (_, i) => `<img src="/img/${i}.png">`).join('');
    const { images, truncated } = await scan(tags);
    expect(images).toHaveLength(MAX_IMAGES);
    expect(truncated).toBe('image-cap');
  });

  it('size-cap wins when both caps fire', async () => {
    const extraction = await extractFromHtml('<img src="/a.png">');
    const { truncated } = finalizeManifest({
      pageUrl: PAGE,
      baseHref: extraction.baseHref,
      candidates: extraction.candidates,
      sizeCapHit: true,
      volumeCapHit: true,
    });
    expect(truncated).toBe('size-cap');
  });

  it('keeps small data: URIs and drops oversized ones', async () => {
    const small = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    const big = `data:image/png;base64,${'A'.repeat(120_000)}`;
    const { images } = await scan(`<img src="${small}"><img src="${big}">`);
    expect(urls(images)).toEqual([small]);
    expect((images[0] as ScanImage).ext).toBe('gif');
    expect((images[0] as ScanImage).filename).toBe('inline-1.gif');
  });

  it('drops non-image data URIs and non-http schemes', async () => {
    const html =
      '<img src="data:text/html,hi"><img src="javascript:alert(1)"><img src="blob:https://x/y"><img src="/ok.png">';
    const { images } = await scan(html);
    expect(urls(images)).toEqual(['https://site.example/ok.png']);
  });

  it('serializes inline svg to a data URI, nested elements and all', async () => {
    const html =
      '<p>before</p><svg viewBox="0 0 10 10"><path d="M0 0"/><g fill="red"><circle r="4"/></g><text>hi</text></svg>';
    const { images } = await scan(html);
    expect(images).toHaveLength(1);
    const image = images[0] as ScanImage;
    expect(image.source).toBe('inline-svg');
    expect(image.ext).toBe('svg');
    const markup = decodeURIComponent(image.url.replace('data:image/svg+xml,', ''));
    expect(markup).toBe(
      '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/><g fill="red"><circle r="4"/></g><text>hi</text></svg>',
    );
  });

  it('extracts inline style attributes and style blocks', async () => {
    const html = [
      '<div style="background-image:url(/css/attr.png)"></div>',
      '<style>.hero{background:url("/css/block.jpg")} .x{background:image-set("/css/set.webp" 1x)}</style>',
    ].join('');
    const { images } = await scan(html);
    expect(urls(images)).toEqual([
      'https://site.example/css/attr.png',
      'https://site.example/css/block.jpg',
      'https://site.example/css/set.webp',
    ]);
    expect(images.map((i) => i.source)).toEqual(['style-attr', 'style-block', 'style-block']);
  });

  it('collects video posters, object data, and embed src', async () => {
    const html =
      '<video poster="/v/poster.jpg"></video><object data="/o/diagram.svg"></object><embed src="/e/pic.png">';
    const { images } = await scan(html);
    expect(images.map((i) => [i.source, i.url])).toEqual([
      ['poster', 'https://site.example/v/poster.jpg'],
      ['object', 'https://site.example/o/diagram.svg'],
      ['embed', 'https://site.example/e/pic.png'],
    ]);
  });

  it('collects favicons and social meta images', async () => {
    const html = [
      '<link rel="icon" href="/favicon.ico">',
      '<link rel="shortcut icon" href="/favicon2.ico">',
      '<link rel="apple-touch-icon" href="/apple.png">',
      '<meta property="og:image" content="/og.jpg">',
      '<meta name="twitter:image" content="/tw.jpg">',
    ].join('');
    const { images } = await scan(html);
    expect(images.map((i) => i.source)).toEqual(['favicon', 'favicon', 'favicon', 'meta', 'meta']);
  });

  it('walks JSON-LD image fields', async () => {
    const ld = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      image: ['/ld/a.jpg', { '@type': 'ImageObject', url: '/ld/b.jpg' }],
      author: { '@type': 'Person', image: { contentUrl: '/ld/author.jpg' } },
    });
    const html = `<script type="application/ld+json">${ld}</script>`;
    const { images } = await scan(html);
    expect(urls(images)).toEqual([
      'https://site.example/ld/a.jpg',
      'https://site.example/ld/b.jpg',
      'https://site.example/ld/author.jpg',
    ]);
    expect(images.every((i) => i.source === 'json-ld')).toBe(true);
  });

  it('ignores malformed JSON-LD and non-ld scripts', async () => {
    const html =
      '<script type="application/ld+json">{not json</script><script>var x = {image: "/no.png"};</script><img src="/yes.png">';
    const { images } = await scan(html);
    expect(urls(images)).toEqual(['https://site.example/yes.png']);
  });

  it('reports stylesheet hrefs capped at 3 without treating them as images', async () => {
    const html = [
      '<link rel="stylesheet" href="/a.css">',
      '<link rel="stylesheet" href="/b.css">',
      '<link rel="stylesheet" href="/c.css">',
      '<link rel="stylesheet" href="/d.css">',
    ].join('');
    const extraction = await extractFromHtml(html);
    expect(extraction.stylesheetHrefs).toEqual(['/a.css', '/b.css', '/c.css']);
    expect(extraction.candidates).toEqual([]);
  });
});
