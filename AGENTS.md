# imageextract.pics

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

---

## What this project is

A free web tool that takes a public webpage URL and lists every image on it, so the user can preview, filter, and download them individually or as a ZIP.

## Non-negotiable constraints

**Nothing is persisted.** No database, no KV, no R2, no D1, no cache of user-submitted URLs. No page URL or image URL appears in any log line. Bytes stream through and are forgotten. If a task seems to require storage, stop and ask before adding it.

**Zero persistence is not zero traffic.** Image bytes must pass through our proxy for downloads, because CORS prevents the browser from reading cross-origin image data and browsers ignore the `download` attribute on cross-origin links. The proxy is required; storage is not.

**The proxy is publicly reachable and therefore an SSRF target.** See the security section below. Treat it as the highest-risk code in the repo.

## Stack

- Astro 5, TypeScript strict, Tailwind
- React only as an Astro island, and only for the interactive results grid
- Cloudflare Workers with static assets — site and API deploy as one unit
- `HTMLRewriter` for HTML parsing (built into Workers, streaming, no dependency)
- `zod` for validating query params at the Worker boundary
- `client-zip` for building ZIPs in the browser
- Vitest for unit tests, Playwright for browser tests

State the license of any new dependency when you introduce it. No AGPL.

## Architecture

Two endpoints, both stateless:

**`GET /api/scan?url=<encoded>`** — fetches the target page, parses it with `HTMLRewriter`, returns a JSON manifest of image URLs. No dimensions, no byte sizes. 1–3 subrequests total.

**`GET /api/proxy?url=<encoded>&download=1`** — streams exactly one image. Pass the `ReadableStream` straight through; never buffer. 1 subrequest, near-zero CPU.

Everything expensive happens in the browser: previews, dimension detection, filtering, sorting, selection state, ZIP assembly.

### Manifest shape

```ts
type ScanResult = {
  pageUrl: string;
  images: Array<{
    id: string;          // stable hash of the URL
    url: string;         // absolute, resolved
    filename: string;    // derived from path, sanitized
    ext: 'png'|'jpeg'|'svg'|'gif'|'webp'|'avif'|'ico'|'unknown';
    source: 'img'|'srcset'|'picture'|'css'|'inline-svg'|'meta'|'poster'|'favicon'|'json-ld';
  }>;
  truncated: boolean;
  robotsBlocked?: true;
};
```

### Why ZIP assembly is client-side

The browser fetches each selected image through `/api/proxy` and assembles the ZIP locally. This keeps each Worker invocation to a single subrequest, so Cloudflare's per-invocation subrequest and CPU limits never become a constraint, and a 400-image download cannot time out a Worker. Do not build ZIPs server-side.

## Cost model — memorize this

| Feature | Where it runs | Cost |
|---|---|---|
| Thumbnail preview | `<img>` pointed directly at the origin | Zero |
| Dimension badge | `naturalWidth`/`naturalHeight` on load | Zero |
| Type filter, search, sort, select | Client state | Zero |
| Copy URLs | Clipboard | Zero |
| Byte-size badge | `HEAD` via proxy — **lazy only** | 1 subrequest |
| Download / ZIP | Proxy | 1 subrequest per image + bandwidth |

Byte-size badges must be lazy: show `—` until the user selects an image or sorts by size. Probing every image upfront on an 800-image page is the difference between a free tool and a bill.

Hotlink-protected origins will 403 the direct preview. Detect `onerror` and fall back to the proxy for that one thumbnail only.

## Security

The SSRF guard applies to **both** endpoints, on the initial URL and after **every** redirect:

1. Scheme must be `http` or `https`
2. Reject private and reserved ranges: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `0.0.0.0/8`, `::1`, `fc00::/7`, `fe80::/10`, and IPv4-mapped IPv6 such as `::ffff:10.0.0.1`
3. Reject ports outside 80 and 443
4. Maximum 3 redirects, re-validating every hop
5. Hard timeouts: 10s for scan, 30s for proxy

Other limits: 100 KB cap on `robots.txt`, 5 MB cap on the fetched HTML, per-image size cap, cap on images per ZIP, 1,000 images per scan with a `truncated` flag.

The proxy must reject non-image `Content-Type`, and must set `X-Content-Type-Options: nosniff` plus `Content-Disposition: attachment` when `download=1`.

Sanitize filenames on download: strip path separators, control characters, and leading dots; cap length; deduplicate with a numeric suffix.

## Politeness

- Respect `robots.txt` before scanning. On a block, return `robotsBlocked` and show "This site has asked automated tools not to access this page." **No override button.**
- Honest User-Agent naming the tool with a URL explaining it.
- Rate limit by IP: roughly 30 scans/hour, 500 proxy calls/hour.
- Copyright notice above the results grid; abuse contact in the footer.

## Extraction surface

`<img src>` is a small fraction. Resolve everything against `<base href>`, then absolute:

`img[src]`, `img[srcset]`, `source[srcset]` in `<picture>`, lazy attributes (`data-src`, `data-lazy-src`, `data-original`, `data-srcset`, `data-bg` — note these appear on `<div>` as well as `<img>`), inline `style="background-image:url()"` and `image-set()`, `<style>` blocks, linked stylesheets (cap at 3), `video[poster]`, `<object data>`, `<embed src>`, inline `<svg>` (serialize the element; there is no URL), `link[rel~=icon]` and `apple-touch-icon`, `og:image` and `twitter:image` meta, JSON-LD `image` fields.

Then dedupe by normalized URL (strip fragment, sort query params) and drop `data:` URIs over 100 KB.

## Code conventions

- Errors are typed and enumerated, never bare strings: `BlockedHostError`, `RobotsBlockedError`, `TimeoutError`, `SizeLimitError`, `NotAnImageError`. Each maps to a specific user-facing message and HTTP status. No catch-all "Something went wrong."
- Astro pages ship zero JavaScript by default. Add `client:*` directives only to the results grid.
- Comments explain *why* — a spec quirk, a workaround for a class of malformed page — not *what*.
- Every `URL.createObjectURL` has a matching `revokeObjectURL`.

## SEO

Traffic is the entire acquisition channel, so this is an architectural concern rather than a marketing afterthought. Every tool variant gets its own statically generated page with real explanatory copy, generated from a content collection. Budget: LCP under 2.0s on 4G.

## Definition of done

- [ ] SSRF guard unit-tested against every reserved range, including a redirect chain into one
- [ ] Nothing written to KV, R2, D1, or cache
- [ ] No URLs in logs
- [ ] `robots.txt` respected with no override path
- [ ] Rate limits live before public launch
- [ ] Byte-size probing verified lazy by counting network calls on a large page
- [ ] Preview falls back to proxy on hotlink 403
- [ ] Large ZIP completes on a mid-range Android phone
- [ ] `limits` block set in `wrangler.jsonc`
- [ ] Copyright notice and abuse contact shipped

## How to work with me

- If a requirement is ambiguous in a way that changes the architecture, ask before building.
- Plan first for anything non-trivial. Wait for confirmation before writing code.
- Name the tradeoff on every recommendation — one line on what it costs.
- If my approach is worse than an alternative, say so before building it.
- Complete, runnable code. No placeholders or "rest of implementation" comments.
- I am new to this stack. Explain unfamiliar concepts briefly when they come up, without being asked.