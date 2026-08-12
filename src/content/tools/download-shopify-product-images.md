---
h1: Download product images from a Shopify store
metaTitle: Download product images from a Shopify store — ImageExtract
metaDescription: Pull the product photography off a Shopify collection or product page. Measured at 90–98% of what a real browser loads on two live stores.
axis: use-case
lead: >-
  Paste a collection or product URL from any Shopify store and the scanner
  collects the product photography the page carries, including the responsive
  size variants a store generates for each photo. Shopify renders its catalogue
  into the HTML, which is why this works well — measured against a real browser
  on two live stores, it finds 90–98% of what the browser loads.
placeholder: https://your-store.myshopify.com/collections/all
funnel:
  source:
    - page
claims:
  - text: >-
      Measured, not asserted: on a live Shopify collection the scanner finds
      98.1% of the images a real browser loads, checked against headless
      Chromium ground truth rather than estimated.
    headline: true
    evidence:
      corpus: gymshark
      figure: 98.1%
  - text: >-
      A second live store measured independently at 90.7%, so the first number
      is a class result rather than one lucky page.
    evidence:
      corpus: allbirds
      figure: 90.7%
  - text: >-
      Every responsive size a store declares for a photo is listed, not only
      the one your screen happened to load, so the largest available version is
      there to pick.
    evidence:
      code: IMAGE_SOURCES
  - text: >-
      Sorting by image size finds the full-resolution originals among the
      thumbnails, and the dimensions come from one small range request per
      image rather than downloading anything.
    evidence:
      code: probeMeta
limits:
  - text: >-
      A store's CDN serves the same photo at many sizes, and each is currently
      its own tile. Expect several tiles per product photo, sort by size, and
      take the largest.
  - text: >-
      Only what the page itself carries is read. A collection that loads more
      products as you scroll has the first batch in its HTML and the rest in
      JavaScript, so scan a product page directly when you need one product's
      full set.
  - text: >-
      Some storefronts sit behind bot protection that serves a challenge page
      rather than the catalogue. The scan succeeds and returns almost nothing —
      that is the wall answering, not the parser failing, and a browser-based
      tool meets the same wall.
  - text: >-
      One archive holds up to 500 images, which a large collection with several
      variants per product can exceed. Filter or sort before selecting.
    evidence:
      code: MAX_ZIP_IMAGES
  - text: >-
      If the store's robots.txt asks automated tools not to read the page, the
      scan stops and says so. There is no override.
faq:
  - q: Collection page or product page?
    a: >-
      Product page for one item's full set, including the alternate angles a
      collection tile never shows. Collection page for a broad sweep of the
      catalogue at whatever size the grid uses. They answer different
      questions, and the product page is the one people usually want.
  - q: Why does one photo appear several times?
    a: >-
      Shopify generates a set of sizes for every image and declares them all so
      browsers can pick. The page lists everything declared, so one photo
      arrives as several entries at different widths. Sorting by image size
      groups the big ones together.
  - q: How do I get the highest-resolution version?
    a: >-
      Sort by Image size, largest first, and measure if the dimensions are not
      already known. The largest declared variant is the best the store serves
      publicly — there is no hidden original behind it.
  - q: Does this work on stores with a custom domain?
    a: >-
      Yes. Shopify stores mostly run on their own domains, and nothing here
      keys on the myshopify.com hostname — it reads the page it is given.
  - q: Is it only Shopify?
    a: >-
      No, but Shopify is the platform the coverage was measured on. Any store
      that renders its catalogue into HTML behaves the same way; stores that
      build the grid entirely in JavaScript return much less.
assumes:
  - absent: collapseVariants
    affects: limits[0] and faq[1] — the "several tiles per photo" answers
    because: >-
      Both currently tell the visitor to expect one tile per size variant and
      to sort by size to find the original. Variant collapse folds a photo's
      variants into ONE tile with the others behind it, at which point that
      advice is wrong twice over: the tile count changes and picking the
      largest stops being a sort-and-scan job. Rewrite both to describe the
      collapsed tile.
related:
  - download-png-images
---

## Why Shopify specifically

Shopify renders product data into the HTML it serves. The catalogue is in the
page before any JavaScript runs, which is exactly the condition a static parser
needs — and it is why the coverage numbers on this page are high enough to
publish.

That is not true of every storefront. A store built as a single-page app
assembles its grid in the browser from an API, and there is nothing in the
served HTML to read. Both kinds exist; the measured ones here are the first
kind.

## What the numbers mean

Coverage was measured against a browser, not estimated. A headless Chromium
loaded each store's collection page, scrolled to the bottom to trigger lazy
loading, and recorded every image it actually fetched. The scanner read the
same URL, and the two lists were compared.

The comparison counts logical images rather than exact URLs. A store serving
one photo at eight widths is one image, not eight — counting URLs would score
a perfect result as a poor one, which is a measurement error rather than a
finding. The full method and corpus are in the project's frontend plan.
