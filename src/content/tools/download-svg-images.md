---
h1: Download the SVGs from a web page
metaTitle: Download SVG images and icons from a website — ImageExtract
metaDescription: Extract SVG files and inline SVG icons from any public page. Inline icons are serialised straight out of the markup, not just the ones with a URL.
axis: format
lead: >-
  Paste a page URL and the scanner collects both kinds of SVG a page can hold:
  files referenced by a URL, and inline SVG elements written directly into the
  HTML. The second kind is where most site icons live and where most tools
  stop, because an inline icon has no URL to find.
placeholder: https://example.com
funnel:
  format:
    - svg
claims:
  - text: >-
      Inline SVG elements are captured, not skipped. An icon written straight
      into the markup has no URL to scrape, so it is serialised out of the
      document and offered as a downloadable file like any other image.
    headline: true
    evidence:
      code: MAX_DATA_URI
  - text: >-
      Both kinds arrive in one list: SVG files referenced from img, CSS
      backgrounds, favicons or social tags, alongside the inline ones, each
      labelled with where it came from.
    evidence:
      code: IMAGE_SOURCES
  - text: >-
      Inline SVGs download with no request to anyone. They are already in the
      page you scanned, so the download is local and the site is never asked
      for them.
    evidence:
      code: downloadHref
  - text: >-
      Icons preview at their real size rather than being blown up to fill a
      tile, so a 24px glyph is recognisable instead of a smear.
    evidence:
      code: ICON_SOURCES
limits:
  - text: >-
      An inline icon is serialised as it appears in the markup. If the page
      colours or sizes it with external CSS, the standalone file will not carry
      that styling — you get the shape the page provided, not the appearance it
      painted.
  - text: >-
      Identical inline SVGs collapse into one entry. A site using the same
      arrow glyph forty times lists it once, which is usually what you want and
      is worth knowing before you count tiles against the page.
  - text: >-
      An inline SVG over 100 KB is skipped rather than serialised. That size is
      an illustration rather than an icon, and it is typically also present as
      a file.
    evidence:
      code: MAX_DATA_URI
  - text: >-
      SVGs built by JavaScript after the page loads are not in the HTML the
      server sent, so they are not found. Charting libraries are the common
      case.
  - text: >-
      If the site's robots.txt asks automated tools not to read the page, the
      scan stops and says so. There is no override.
faq:
  - q: What is an inline SVG, and why does it matter here?
    a: >-
      An SVG can be a file the page links to, or markup written directly into
      the page's HTML. The second is now the normal way to ship interface
      icons, and it has no URL — so a tool that looks for image URLs finds
      nothing. We read the element itself and rebuild it as a file.
  - q: Will the downloaded icon look exactly like it does on the site?
    a: >-
      The shape will. The colour may not. Sites frequently leave an icon's fill
      to the surrounding CSS, and that styling lives outside the element we
      extract. What you get is the geometry as the page provided it, which is
      what you want for reuse anyway.
  - q: Why do I see fewer icons than the page appears to show?
    a: >-
      Identical inline SVGs are listed once. The same chevron repeated down a
      menu is one entry here and forty instances on the page.
  - q: Can I get the icons out of a sprite sheet?
    a: >-
      Only as the sprite. A symbol sprite is one SVG file holding many glyphs;
      we hand you the file, not the individual symbols inside it.
assumes: []
related:
  - download-png-images
---

## The two kinds of SVG, and why the second one is the point

An SVG on a web page is either a file the page points at, or markup written
directly into the HTML. Both are ordinary on modern sites, and they behave
completely differently for anyone trying to extract them.

A file is easy: it has a URL, so anything that reads image URLs will find it.
Inline SVG has no URL. It is a fragment of the page itself, which is why
interface icons are shipped that way — no extra request, and CSS can restyle
them. It is also why most extraction tools return a site's photographs and
none of its iconography.

We read the element and rebuild it as a standalone file, so it lands in the
grid beside everything else and downloads like any other image.

## What that means for the download

Inline SVGs never touch our proxy. They came from the page you scanned, they
are already in your browser, and the download is assembled locally — no
request to the site, nothing streamed through us.

Referenced SVG files behave like any other image: the preview loads from the
origin, and downloading fetches the file through the proxy because a browser
will not save a cross-origin file otherwise.
