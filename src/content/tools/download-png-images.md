---
h1: Download every PNG on a web page
metaTitle: Download all PNG images from a web page — ImageExtract
metaDescription: Paste a URL and get every PNG the page references — srcset, CSS backgrounds, favicons and social tags included. No signup. Nothing is stored.
axis: format
lead: >-
  Paste a page URL and the scanner reads the HTML the server sends, collects
  every PNG it references, and hands you a grid already filtered to PNG. One
  thing to know before you look at it: the format label comes from the image's
  file extension, so a PNG served from an extensionless CDN URL arrives under
  UNKNOWN rather than PNG — untick the filter and it is there.
placeholder: https://example.com
funnel:
  format:
    - png
claims:
  - text: >-
      PNGs are found everywhere the page references them — not just img src
      attributes, but srcset candidates, picture sources, CSS backgrounds in
      stylesheets and inline styles, lazy-load attributes, favicons, Open Graph
      tags and JSON-LD.
    headline: true
    evidence:
      code: IMAGE_SOURCES
  - text: >-
      Arriving from this page, the grid is already filtered to PNG — and the
      filter is a ticked checkbox in the sidebar, not a hidden mode, so one
      click widens it to everything found.
    evidence:
      code: parseFormatParam
  - text: >-
      What you download is the origin's exact bytes. Nothing is re-encoded,
      recompressed or flattened, so transparency and interlacing survive the
      trip.
    evidence:
      code: proxyImage
  - text: >-
      Dimensions a page declares show immediately; exact pixel size and file
      size come from a single 4 KB range request, made only for the images you
      ask about.
    evidence:
      code: probeMeta
limits:
  - text: >-
      PNG is read from the URL's file extension. A PNG served from a URL with
      no extension — ordinary on image CDNs — is listed under UNKNOWN rather
      than PNG. Untick the format filter to see those.
    evidence:
      code: extFromPathname
  - text: >-
      Only the HTML the server sends is read. A gallery that builds its img
      tags in JavaScript after load has no PNGs on the page for us to find.
  - text: >-
      Three linked stylesheets are fetched per scan. A PNG background declared
      in a fourth is missed.
    evidence:
      code: MAX_STYLESHEETS
  - text: >-
      One archive holds up to 500 images. A larger selection has to go in more
      than one ZIP.
    evidence:
      code: MAX_ZIP_IMAGES
  - text: >-
      If the site's robots.txt asks automated tools not to read the page, the
      scan stops and says so. There is no override.
faq:
  - q: Why are some PNGs listed as UNKNOWN?
    a: >-
      The format label comes from the image URL's extension. Plenty of CDNs
      serve paths like /image/abc123 with no extension at all, and those land
      in UNKNOWN even when the bytes are a PNG. They are still found, still
      previewable and still downloadable — just not under the PNG filter.
      Untick PNG to see the whole set.
  - q: Will transparency survive the download?
    a: >-
      Yes. The proxy streams the origin's response through untouched — no
      re-encode, no recompression, no background flattening. The file that
      lands on your disk is byte-for-byte the file the site serves.
  - q: The site serves WebP to my browser. Can I still get the PNG?
    a: >-
      Often, yes. We read the page's markup rather than what your browser chose
      to load, so the PNG fallback inside a <picture> element or a srcset list
      is listed alongside the WebP the browser actually picked.
  - q: Does changing the filter re-scan the page?
    a: >-
      No. The scan reads everything once and the filtering happens in your
      browser, so widening from PNG to every format is instant and costs no
      extra request to the site.
assumes:
  - absent: collapseVariants
    affects: faq[2] — "The site serves WebP to my browser"
    because: >-
      That answer is true because every declared variant is currently its own
      tile, so the PNG fallback appears beside the WebP the browser picked.
      Variant collapse (STATUS.md, Phase 2 — owed correctness) will fold a
      <picture> into ONE tile, at which point the answer must say the PNG is
      reachable behind that tile rather than listed alongside it.
related: []
---

## How the PNGs are found

A scan fetches the page once and reads the HTML exactly as the server sent it —
no browser, no JavaScript execution. Every place a page can reference an image
is read on that single pass: the `src` and `srcset` on `<img>`, the `<source>`
elements inside `<picture>`, `background-image` in inline styles and in
`<style>` blocks, the lazy-loading attributes sites use in place of `src`,
`<link rel="icon">` and Apple touch icons, `og:image` and `twitter:image`, and
image fields in JSON-LD. Linked stylesheets are fetched and read too, up to
three of them.

Content inside `<noscript>` is parsed as well, through the same pipeline. That
is deliberate rather than clever: `<noscript>` is the site's own answer to a
non-JavaScript reader, and a static parser is one.

## What arrives

Every PNG the page points at, deduplicated by normalised URL, with the format
and — where the page declares them — the dimensions already on each tile.
Thumbnails load straight from the origin, so previewing costs the site the
same requests a visitor's browser would have made.

Downloading is the only step that goes through our proxy, and it has to: a
browser cannot read cross-origin image bytes or honour a download link across
origins. The bytes pass through and are forgotten — there is no copy on our
side to keep.
