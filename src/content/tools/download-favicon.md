---
h1: Download a site's favicon and touch icons
metaTitle: Favicon downloader — get every icon a site declares — ImageExtract
metaDescription: Pull the favicons and Apple touch icons a page declares, at every size it offers, with the declared sizes shown. No signup, nothing stored.
axis: source
lead: >-
  Paste a page URL and the scanner lists every icon the page declares — the
  classic favicon, the PNG variants, and the Apple touch icons — each with the
  size the page states for it. It reads what the page actually declares rather
  than guessing at the usual filenames, which is the difference between the
  icons a site really uses and a lucky hit on one of them.
placeholder: https://example.com
funnel:
  source:
    - meta
claims:
  - text: >-
      Every icon the page declares is listed: rel="icon" in all its spellings,
      plus apple-touch-icon and apple-touch-icon-precomposed. Sites commonly
      declare six or more, and you get all of them rather than one.
    headline: true
    evidence:
      code: IMAGE_SOURCES
  - text: >-
      The size a page states for each icon is read from its sizes attribute and
      shown on the tile before anything is downloaded, so you can pick the
      resolution you need at a glance.
    evidence:
      code: DIMENSION_SOURCES
  - text: >-
      Icons preview at natural size rather than being upscaled to fill a tile,
      which is what makes a 16px icon distinguishable from a 32px one on
      screen.
    evidence:
      code: ICON_SOURCES
  - text: >-
      The declared size is the page's claim, and one click measures the real
      one: a single 4 KB range request reads the file header and replaces the
      claim with the true dimensions.
    evidence:
      code: probeMeta
limits:
  - text: >-
      Only declared icons are found. A site that serves /favicon.ico purely by
      browser convention, without a link tag, has declared nothing for us to
      read — we never guess at URLs, so nothing appears. Try the URL directly
      in that case.
  - text: >-
      A sizes attribute is a claim by the page, and pages get it wrong. Sizes
      shown as declared are unverified until you measure them; sizes="any",
      which SVG icons commonly use, states no dimensions at all.
  - text: >-
      A multi-resolution .ico file holds several images in one file. It is
      listed and downloaded as the single file it is, not split into its
      component sizes.
  - text: >-
      The grid arrives filtered to "Meta and icons", which is the narrowest
      filter that exists — it holds the social preview images too. Icons are
      labelled favicon on the tile, so they are easy to pick out, but the view
      is slightly wider than this page's title.
    evidence:
      code: SOURCE_GROUPS
  - text: >-
      Icons are declared per page, and pages within one site can declare
      different ones. What you get is what that page declares.
  - text: >-
      If the site's robots.txt asks automated tools not to read the page, the
      scan stops and says so. There is no override.
faq:
  - q: Why does this find nothing on some sites?
    a: >-
      Because the page declares no icons. Browsers fall back to requesting
      /favicon.ico at the domain root whether or not anything says so, and a
      site relying on that convention has nothing in its HTML for a reader to
      find. We do not guess at URLs — guessing produces confident wrong
      answers, like listing an icon that 404s.
  - q: Which icon should I take?
    a: >-
      For a browser tab, 32×32 or the SVG if one is declared. For an app icon
      or a link preview, the Apple touch icon is usually the largest and
      cleanest — often 180×180. The declared sizes are on the tiles.
  - q: Are the sizes shown trustworthy?
    a: >-
      They are the page's own claim, and they are frequently stale — a site
      updates an icon and leaves the old sizes attribute in place. Use Measure
      dimensions and the real numbers replace the claimed ones.
  - q: Can I get the icon from a site's homepage if I scan an inner page?
    a: >-
      Usually yes, because most sites declare the same icons site-wide from a
      shared template. If an inner page declares nothing, scan the homepage.
assumes: []
related:
  - download-og-image
  - download-svg-images
---

## What a page actually declares

A modern site rarely has one favicon. It typically declares a small ICO for
legacy browsers, one or two PNGs, sometimes an SVG, and an Apple touch icon
for home-screen bookmarks — each with its own size and purpose. All of it sits
in the page head as link tags.

This tool reads those tags. That is deliberately narrower than "find the
site's icon" and deliberately more accurate: what a page declares is what
browsers actually use, and the set is usually larger than people expect.

## Why guessing is worse than finding nothing

The obvious shortcut is to request /favicon.ico at the domain root and hand
over whatever comes back. It works often enough to be tempting, and it fails
silently: you get a stale icon a site stopped using, a placeholder from a
hosting provider, or a 404 page served with an image content type.

Reading the declaration means an empty result is informative. It says this
page declares no icons — which is itself the answer, and points you at the
homepage or the root URL rather than leaving you with something wrong.
