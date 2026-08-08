# imageextract.pics

Extract every image from any public webpage. Preview, filter, and download individually or as a ZIP.

**Nothing is stored.** No database, no object storage, no cache of submitted URLs, no URLs in logs. Image bytes stream through and are forgotten.

---

## Status

In development. Not yet deployed.

| Phase | State |
|---|---|
| Foundation, SSRF guard | Done |
| Core engine (`/api/scan`, `/api/proxy`) | `/api/scan` done, proxy next |
| Results UI | Not started |
| Download and ZIP | Not started |
| Abuse controls | Not started |
| Trust pages, SEO, deploy | Not started |

See `STATUS.md` for the full breakdown.

## Stack

- Astro 7, TypeScript strict, Tailwind v4
- Cloudflare Workers with static assets — site and API deploy as one unit
- `HTMLRewriter` for streaming HTML parsing
- React as a single island for the results grid; every other page ships zero JS
- Vitest running in real workerd via `@cloudflare/vitest-pool-workers`

## Fonts

Self-hosted, no third-party font host. Two faces, both under the **SIL Open
Font License 1.1**, which permits self-hosting and redistribution:

| Face | Role | Licence | Notice |
|---|---|---|---|
| Schibsted Grotesk | display + body (weights 400–700) | OFL 1.1 | `src/styles/fonts/schibsted-grotesk-OFL.txt` |
| IBM Plex Mono | metadata, badges, labels (weight 400) | OFL 1.1 | `src/styles/fonts/ibm-plex-mono-OFL.txt` |

Both are latin-subset variable woff2, content-hashed and served immutable.
Total ~56 KB. The OFL notices live beside the woff2 files; keep them together
if the fonts ever move.

## Architecture in one paragraph

Two stateless endpoints. `/api/scan` fetches a page, checks robots.txt, stream-parses the HTML, and returns a JSON manifest of image URLs. `/api/proxy` streams exactly one image, pass-through, near-zero CPU. Everything expensive — previews, dimensions, filtering, sorting, ZIP assembly — happens in the browser. Thumbnails load directly from the origin, so browsing costs nothing; only downloads pass through the proxy.

## Security

The proxy accepts a URL from anyone and fetches it, which is textbook SSRF exposure. `src/lib/ssrf-guard.ts` is the mitigation and is the most security-critical code in the repo. It enforces scheme and port allowlists, rejects every reserved IP range across encodings, rejects internal hostname conventions, follows redirects manually with per-hop revalidation, and runs a fail-closed DNS-over-HTTPS pre-check.

Cloudflare Workers expose no DNS resolution API, so pinning a connection to a validated IP is not possible. DNS rebinding is narrowed, not closed. This is documented rather than hidden.

## Development

```bash
npm install
astro dev --background     # astro dev status | logs | stop
npm test                   # runs in workerd, not Node
npm run build
```

## Politeness

`robots.txt` is respected with no override path. The User-Agent identifies the tool and links to a page explaining it. Rate limits apply per IP. Abuse reports are welcome at the contact address in the footer.

Images retrieved through this tool may be under copyright. Obtaining permission to use them is the user's responsibility.

## Docs

- `AGENTS.md` — architecture, constraints, conventions (read by coding agents automatically)
- `STATUS.md` — phase-by-phase progress and known risks
- `DECISIONS.md` — why things are the way they are