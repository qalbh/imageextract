---
h1: Get the Open Graph image a page declares
metaTitle: Open Graph image extractor — see a page's og:image — ImageExtract
metaDescription: Read the og:image and twitter:image a page declares, with the dimensions it states, and download the file. Extraction, not validation — it shows what the page says.
axis: source
lead: >-
  Paste a page URL and the scanner reads the social preview images it declares
  — og:image in each of its spellings, plus the Twitter card equivalents — with
  any dimensions the page states alongside them. It reports what the page
  declares; it does not predict what a given platform will decide to render.
placeholder: https://example.com
funnel:
  source:
    - meta
claims:
  - text: >-
      Every social image key a page can declare is read, not just the common
      one: og:image, og:image:url, og:image:secure_url, twitter:image and
      twitter:image:src. Pages that declare several get several.
    headline: true
    evidence:
      code: META_IMAGE_KEYS
  - text: >-
      Declared og:image:width and og:image:height are attached to the image
      they belong to, so a page stating 1200×630 shows 1200×630 before you
      fetch anything.
    evidence:
      code: DIMENSION_SOURCES
  - text: >-
      Relative and protocol-relative URLs are resolved the way a browser would,
      against the document's own base, so what you see is the absolute URL a
      platform would fetch.
    evidence:
      code: resolveDocumentBase
  - text: >-
      One click measures the real file instead of trusting the tag: a single
      4 KB range request returns true dimensions and byte size, which is how
      you catch a page declaring 1200×630 for an 800×418 file.
    evidence:
      code: probeMeta
limits:
  - text: >-
      This extracts, it does not validate. It will not tell you whether an
      image meets a platform's aspect or size requirements, and it makes no
      judgement about whether a card will look right.
  - text: >-
      What a platform renders can differ from what a page declares. Crawlers
      fetch pages themselves, cache aggressively, and sometimes ignore the tag
      in favour of their own choice — a correct tag here does not guarantee a
      correct card there.
  - text: >-
      The grid arrives filtered to "Meta and icons", the narrowest filter
      available, so the page's favicons sit alongside its social images. Each
      tile is labelled with its source, and the social ones read meta.
    evidence:
      code: SOURCE_GROUPS
  - text: >-
      Only the page you scan is read. Social tags are per-page, and a site's
      article pages usually declare different images from its homepage.
  - text: >-
      Tags injected by JavaScript are not seen. Crawlers generally do not
      execute JavaScript either, so a tag that only exists after hydration is
      a real problem rather than a limitation of this tool — but this tool
      will not be the thing that tells you which.
  - text: >-
      If the site's robots.txt asks automated tools not to read the page, the
      scan stops and says so. There is no override.
faq:
  - q: The tag is there but the platform shows the wrong image. Why?
    a: >-
      Usually caching. Most platforms fetch a URL's preview once and keep it
      for a long time, so a tag fixed today can render yesterday's image for
      days. Each platform has its own cache-refresh tool. This page tells you
      what the tag currently says, which is the half you can check yourself.
  - q: Does it tell me whether my og:image is the right size?
    a: >-
      No. It shows the declared size and, if you measure, the real one — the
      comparison is yours to make. 1200×630 is the conventional target, but
      requirements differ per platform and change without notice, so a
      hardcoded verdict here would go stale and be believed.
  - q: Why are there several images for one page?
    a: >-
      Pages often declare og:image and twitter:image separately, sometimes with
      different files, and some declare multiple og:image tags for platforms to
      choose between. All of them are listed with their source.
  - q: Can I check a page I have not published yet?
    a: >-
      Only if it is reachable at a public URL. The scanner fetches the page the
      same way any visitor would, so staging behind a login or an IP allowlist
      is not visible to it.
assumes: []
related:
  - download-favicon
---

## What is actually being read

Social previews are declared in the page head as meta tags. There are more of
them than most people track: the Open Graph set, which Facebook, LinkedIn,
Slack, WhatsApp and others consume, and the Twitter card set, which duplicates
part of it. A page can declare any combination, and platforms pick by their own
rules.

This tool reads the whole set and shows each one with its source, so a page
declaring one image for Open Graph and a different one for Twitter shows both
rather than silently preferring one.

## Declared is not verified

An og:image:width tag is a claim the page makes about a file. Nothing enforces
it, and it goes stale the moment someone swaps the image without touching the
tag — which is common, and invisible until a card renders wrong.

Declared values show muted until you measure. Measuring reads the file's own
header through one small range request and replaces the claim with the truth,
which turns "the page says 1200×630" into "the file is 800×418" in one click.
