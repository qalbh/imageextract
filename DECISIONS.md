# Decision log

Why things are the way they are. Append, don't rewrite — a decision that was reversed is more useful with its original reasoning intact.

Format: what was decided, what it cost, and what would make us revisit it.

---

## Client-side processing everywhere except this tool

The wider toolkit runs entirely in the browser so marginal cost per job is zero. This tool is the exception: CORS prevents the browser from reading cross-origin image bytes, and browsers ignore the `download` attribute on cross-origin links. A proxy is unavoidable.

**Cost:** a server exists, with the abuse surface and bandwidth exposure that implies.
**Revisit if:** never — the constraint is a browser security model, not a preference.

## Cloudflare Workers over Vercel and Hostinger

This tool moves other people's bytes. Vercel meters transfer in both directions and has no default spend cap, so an open proxy there is a billing risk proportional to abuse. Cloudflare does not bill egress. Hostinger shared hosting cannot run the required runtime at all, and a VPS would put a real localhost behind the SSRF guard.

**Cost:** learning a less familiar platform; Workers' constraints shape the architecture.
**Revisit if:** Cloudflare changes egress billing, or the product stops proxying bytes.

## Astro over Next.js

The competitive landscape shows this product is a content surface with one interactive widget, not an app. Astro ships zero JS by default and content collections generate landing pages from data.

**Cost:** a second framework in the wider portfolio if the toolkit uses Next.js.
**Revisit if:** the interactive surface grows past one island.

## Static HTML parsing, no headless browser

Competitors run headless browsers and consequently need sign-in, quotas, and ads to cover per-request cost. Static parsing is fast and nearly free, and lets us be the no-signup option.

**Cost:** we will miss images on JavaScript-heavy sites. The size of that
gap was unmeasured when this was decided; measured 2026-08-10 it is far
smaller than feared — 0–1 truly-JS-built images per readable page once our
own noscript and cap gaps were fixed. See "Deep-scan mode closed" below.
**Revisit if:** Phase 8 data shows zero-result scans above 30%. Cloudflare Browser Rendering is the escape hatch, on the same platform.

## Zero persistence

No database, no KV, no R2, no cache of submitted URLs, no URLs in logs. Storing other people's images makes us a host rather than a conduit; storing nothing keeps the legal position simple and removes an entire class of liability.

**Cost:** no scan history, no resumable jobs, no analytics richer than aggregates.
**Revisit if:** never, without an explicit conversation.

**Carve-out:** the DoH verdict cache holds hostnames in isolate memory for up to 60s. Never written, never logged, not queryable, dies with the isolate — the same category as a local variable. Documented explicitly so it isn't later read as a quiet violation.

## ZIP assembly in the browser

The browser fetches each image through the proxy and assembles the ZIP locally. Each Worker invocation stays at a single subrequest, so per-invocation subrequest and CPU limits never bind, and a large download cannot time out a Worker.

**Cost:** ZIP behaviour now depends on the client device. A large selection must be verified on a mid-range phone.

## SSRF guard shaped by platform limits

Workers expose no DNS resolution API, so "resolve the hostname and connect to the validated IP" is not implementable. The guard is built from what exists: scheme and port allowlists, reserved-range rejection across all IP encodings, internal hostname conventions, manual redirect following with per-hop revalidation, and a fail-closed DNS-over-HTTPS pre-check.

**Cost:** DNS rebinding is narrowed, not closed. Documented rather than papered over.
**Revisit if:** Cloudflare ever exposes connection pinning.

A compatibility flag was initially believed to block private-IP fetches at the platform level. Checking the documentation showed it governs same-zone routing instead. **No platform-level SSRF protection is assumed anywhere in this codebase.**

## Tests run in workerd, not Node

URL parsing and redirect semantics can differ between runtimes. A guard that passes in Node and behaves differently in production is worse than no guard, because it gets trusted.

**Cost:** one dev dependency and a config file that must track `wrangler.jsonc`.

## robots.txt respected, no override

The tool is public, named, and runs from fixed infrastructure. Honouring a site's stated preference is the defensible position in every abuse complaint that will ever arrive. An override button turns a good-faith tool into a circumvention tool.

**Cost:** some sites cannot be scanned at all.
**Revisit if:** never.

## DoH included now rather than deferred to launch

Without it, the guard only catches a literal private IP in the URL — the naive case. With it, a public hostname resolving to a private address is also caught, which is how the attack is normally delivered. Deferred security work gets built under launch pressure, and retrofitting an async check into synchronous validation is a refactor.

**Cost:** two subrequests per uncached hostname.

## `truncated` carries a reason, not a boolean

Hitting the 1000-image cap and hitting the 5 MB page cap are different failures with different user remedies. One means the list was trimmed; the other means part of the page was never parsed. A shared boolean would produce a UI that gives the wrong advice.

## `source` enum is granular

Every extraction origin gets its own value, including the three CSS variants, which resolve against different bases and fail in different ways. When a site returns garbage, `source` is the only debugging handle — "all from `css-external`" points at stylesheet base resolution; "all from `img`" points nowhere.

## `/` ships zero JavaScript

The homepage is the acquisition surface and competes on load speed; the only interactive widget lives on `/results`. The URL form is a native GET form posting to `/results?url=…`, so scan links work — and are shareable — without a single script on either the sender's or receiver's side of the link.

**Cost:** every scan is a full navigation rather than an in-place update; two routes instead of one.
**Revisit if:** the homepage itself grows interactive features — same trigger as the Astro-over-Next decision.

## Thumbnails send no Referer

`/results` carries `<meta name="referrer" content="no-referrer">`. Thumbnails load direct from each image's origin, and without this meta every third-party host on a scanned page receives a Referer containing our results URL — which contains the scanned page URL. That leaks the user's query to every origin on the page, contradicting the product's stated privacy position.

**Cost:** some hotlink protection blocks empty-referer requests, so the preview 403 rate rises. The per-tile proxy fallback (frontend plan, step 8) is the remedy.
**Revisit if:** never — the privacy position is not negotiable.

## Correction: vitest config cost

The "Tests run in workerd" entry above states its cost as "one dev dependency and a config file that must track `wrangler.jsonc`." The hand-tracking no longer applies: `vitest.config.ts` now reads `wrangler.jsonc` directly and derives the compatibility date and flags from it, so the two cannot drift. The decision itself is unchanged — only the stated cost is now smaller.

## Correction: `source` enum example

The "source enum is granular" entry above cites a `css-external` value. No such value exists — the linked-stylesheet source is named `stylesheet`, and the three CSS variants are `style-attr`, `style-block`, `stylesheet`. The reasoning is unaffected; per-origin granularity remains the debugging handle. Only the example name was wrong.

## Demo images committed, not hotlinked

The landing-page demo grid ships its images from our own repo rather than hotlinking Unsplash or any third-party CDN. Three reasons compound: hotlinking makes every landing-page visitor issue cross-origin requests to a third party, which contradicts the product's privacy position; it puts ~15 uncontrolled cross-origin fetches in front of the LCP element on the one page the entire acquisition channel depends on; and demonstrating an image-extraction tool by hotlinking someone else's CDN, directly above a copyright notice, is the wrong optic.

**Cost:** ~120 KB committed to the repo, and refreshing the demo set is a manual step.
**Revisit if:** the demo set grows large enough that repo weight outweighs the privacy, performance, and optics case.

## Preact (via `@astrojs/preact` compat) over React

The `/results` island is one component using only `useState` and `useEffect`, but React shipped 197 KB of runtime to render it — on the page a mid-range Android loads with potentially hundreds of tiles. We moved to Preact through `@astrojs/preact` with `compat: true`, which aliases react and react-dom to `preact/compat` on the integration's supported path, so we keep writing React-flavoured JSX while shipping Preact's runtime. `preact-render-to-string` arrives as a proper transitive dependency of the integration, not a manual patch.

Measured: `/results` fell from 197,189 B to 26,645 B of module JavaScript — a 170,544 B saving (86.5%). `/` stays zero-JS. All six island behaviours were verified in a real browser (bare prompt, form-submit scan, shared-link navigation, live scan, dimension badges from `naturalWidth`, hotlink fallback). `@tanstack/react-virtual` — the named virtualization escalation — was verified genuinely windowing under compat (10,000 rows, 14 in the DOM, scroll updates the window, no errors) before the sidebar is built on top. tsc now validates against the compat types (tsconfig `paths` + `jsxImportSource: preact`), not `@types/react`, and nothing surfaced.

**Cost:** a compat shim sits between us and React's real behaviour, and some ecosystem packages misbehave under it. Exposure today is small — only `useState` and `useEffect` — and grows with the sidebar, filter state, and selection model.
**Revisit if:** we need a React feature compat does not cover (concurrent rendering, Suspense-for-data, or a library that reaches past the compat surface).

## `nodejs_compat` rejected for the Preact SSR renderer

An earlier attempt kept `@astrojs/react` and aliased react to `preact/compat` at the Vite level. It failed to build on Cloudflare because `preact-render-to-string` imports `node:stream`, which the workerd prerender environment does not provide. Enabling the `nodejs_compat` flag would have cleared it — and was rejected: it permanently broadens the Worker's runtime surface to work around one transitive import in a build-time renderer. `@astrojs/preact` renders through the supported path and sidesteps the import entirely, so the flag is unnecessary.

**Cost:** none beyond choosing the integration over the hand-rolled alias.
**Revisit if:** never for this reason.

## Dev-server cleanup needs an explicit workerd sweep

The Cloudflare adapter runs the dev Worker as a **separate `workerd` child
process**, and Astro's `killDevServer` (behind `astro dev stop`) sends
SIGTERM→SIGKILL to the **node pid only** — never the process group — so workerd
is orphaned on nearly every stop and holds its ports. Background mode, where
this happens, is **force-enabled in agent shells** (Astro detects the
environment and detaches regardless), so it can't be sidestepped by running in
the foreground. A reliable teardown must therefore reap workerd itself
(`pkill -9 -f "workerd serve"`), and `.astro` must not be deleted until `ps`
confirms no process survives — deleting the lockfile under a live server is
what desyncs `astro dev stop` and drives the port-climbing.

**Cost:** every restart needs an explicit workerd sweep; the documented reset
recipe has more steps and a mandatory ordering.
**Revisit if:** Astro or the Cloudflare adapter starts killing the process
group (or otherwise reaping the workerd child) on shutdown — then the sweep
becomes redundant and this can revert to a plain `astro dev stop`.

## Incremental reveal over pagination

The results grid scales by an incremental reveal — an initial cap of 120
tiles (the `TILE_REVEAL_CAP` constant), an IntersectionObserver appending
another batch as the user scrolls, and content-visibility: auto on the
fixed-ratio tiles so off-screen ones skip rendering — not by pagination, and
not (yet) by virtualization. Recorded here belatedly: the decision shipped in
Phase 2 and has overridden the Figma frame twice (the frame shows page
controls), but until now lived only in the frontend plan and design-system
notes, while being cited as a DECISIONS entry.

Pagination was rejected on two interactions, not aesthetics: a page control
resets on every filter change, so a user narrowing 800 images loses their
place each time a checkbox flips; and it makes select-all ambiguous — "select
all" on page 2 of 4 either lies about its scope or silently spans pages the
user never saw. The reveal model keeps one continuous list, so select-all
over the whole filtered set (the pinned behaviour) stays honest, and a filter
change simply resets the window to the first 120 of the new set.

**Cost:** the DOM grows as the user scrolls — reveal bounds the initial
render, not the eventual total; content-visibility keeps off-screen tiles
cheap but they still exist as nodes. Verified to 220 tiles at 4× CPU
throttle; the mid-range-phone run is still owed (Phase 3 device pass).
**Revisit if:** the device run janks on a 1,000-image scan — the escalation
path is `@tanstack/react-virtual` (MIT), already verified to genuinely
window under the Preact compat layer before the sidebar was built on top.

## The proxy stays referrerless; the fallback recovers less than implied

Live check (2026-08-10) against real origins: the referrerless-403 class is
real — i.pximg.net 403s referrerless at the edge (before path lookup),
wx1.sinaimg.cn returns 403 referrerless vs 404 (a real lookup) with a weibo
referer, doubanio 418 vs 404 — and for this commonest protected class
(origins that REQUIRE a matching referer) our proxy fails exactly like the
browser, because it also sends no Referer. The "Thumbnails send no Referer"
entry above calls the per-tile proxy fallback the remedy for the elevated
403 rate; for referer-required origins it is not. The fallback's genuine
recovery classes are narrower: CORP/ORB-blocked origins (the browser refuses
to embed cross-origin; a server-side fetch reads fine and re-serves from our
origin) and geo/IP splits where the user's network and Cloudflare's edge get
different answers. The mechanism stays because it costs nothing when it
loses — one bounded retry, then an honest dead tile.

Sending a Referer would recover the referer-required class and was
rejected — and not on privacy grounds. The privacy argument is weak:
hotlink protection passes only when the referer matches the origin's own
domain, so the referer we would send discloses a page fetch that same
origin already served during the scan; it learns nothing new. The real
argument is the robots one: sending a Referer claiming the request came
from browsing that page, when it didn't, impersonates a browser context to
defeat a control the site deliberately configured. That is what turns a
good-faith tool into a circumvention tool — the same line the no-override
robots rule draws.

**Cost:** dead tiles for referer-required origins, and downloads from those
tiles fail the same way.
**Revisit if:** never on the impersonation point. The recovery-class list
can be re-derived if real scan data surfaces new splits.

## Dimensions are probed on demand, not loaded upfront

Sorting by image size, width, or height needs real dimensions, and declared
manifest data covers only 19% of entries. Competitors have this data with no
probe step because they run a headless browser: every image is fully loaded
during the scan, for every scan, for every visitor — they pay upfront
whether or not anyone sorts. We probe on demand: one prefix Range request
through the proxy reads the file header (PNG in 24 bytes, JPEG's SOF within
4 KB) and returns exact dimensions AND, via Content-Range's total, the full
byte size — one subrequest answers both questions, which is why it replaced
the client's HEAD probe outright. The user pays for what they ask about:
scrolled thumbnails measure themselves free via naturalWidth, declared data
covers what pages state, and the explicit "Measure dimensions (N)" action
covers the rest with its count as the consent.

This is the same upfront-vs-on-demand tradeoff recorded above for static
parsing itself, and it will come up again: any future "why don't we just
know X about every image" has the same answer — knowing upfront costs a
headless browser per scan.

**Cost:** dimension-complete sorting is one explicit click and one
subrequest per unmeasured image, not automatic.
**Revisit if:** the static-parse decision itself is revisited (Phase 8
coverage data) — the two stand or fall together.

## Deep-scan mode closed: the boundary is bot walls, not JavaScript

Decided 2026-08-10, on the coverage diagnosis (method and corpus table in
frontend-plan.md). The Phase 8 question was "does the data justify a
headless-browser deep scan?" The data answered a different question than
the one we feared. The assumption was that JavaScript builds images a
static parse cannot see; measured against browser ground truth on every
page whose HTML we could actually read, the truly-JS-built residue was
**0–1 images per page**. The big gaps were ours: noscript content
discarded (half of apple.com's images), and a cap that counted srcset
candidates instead of logical images (a Shopify collection at 45.6% for
that reason alone). Both fixed the day they were found; the corpus then
reads 90–100% everywhere the origin serves real HTML.

What remains unreachable is what origins refuse to serve: Anubis
proof-of-work walls (unsplash rejected us with its mascot), challenge
pages (etsy: successful scan, zero images), and per-request lotteries
(amazon: 0, some, and 117 images across three identical scans). No parser
reaches content that never arrives, and headless browsers hit the same
walls — a deep-scan mode buys ~1 image per readable page and nothing at
all behind a wall.

The honest-UA cost, now measured rather than assumed: identifying as
`ImageExtractBot` is precisely what bot walls key on, so honesty makes us
*more* wallable than a UA-spoofing competitor. That is the values choice
already made ("robots.txt respected, no override" — same reasoning:
impersonating a browser to defeat an origin's stated wishes is the thing
we decided not to be). The number now sits next to the choice: it costs
us the walled giants, and it costs everyone else those too.

**Cost:** JS-only galleries (an app-shell page whose HTML holds no images)
still scan empty, and walled origins scan empty or thin.
**Revisit if:** live-scan telemetry shows a class of *readable* pages with
a large truly-absent residue — that would mean the corpus was
unrepresentative, not that the walls moved.

## Coverage counts logical images, not exact URLs

The first coverage sweep scored guardian at 1% and astro.build at 14% —
exact-URL matching against what the browser loaded. Both are actually
100%: the browser picks ONE sizing variant (by viewport, DPR, and in
guardian's case UA-dependent srcset generation) from a set the manifest
lists in full. The metric was wrong, not the scanner. Coverage claims in
this project are therefore stated in **logical images** (same
origin+path, any variant params), with exact-URL given alongside only as
a diagnostic.

Consequence for the UI: this reframes the deferred variantGroup-collapse
work from polish to **correctness** — a grid that shows eight tiles for
one product photo is misrepresenting what was found, in exactly the way
exact-URL matching misrepresented coverage. Still deferred, but it is
owed, not optional.

**Cost:** none — this is a measurement and presentation rule.
**Revisit if:** never; exact-URL identity was simply the wrong unit.

## The proxy allowance is politeness, not cost recovery

Decided 2026-08-10: **1,000 proxy calls/hour per IP; `MAX_ZIP_IMAGES`
pinned at half (500) and moving with it; scans stay at 30/hour.**

The number came from a measured session model, not a guess: a normal
session (128-image scan, browse, measure, size, 120-ZIP) costs ~225
proxy calls; a thorough session (553-entry page, Measure ~350, 250-ZIP)
~615; thorough with a maximal 500-member ZIP ~865. The deliberate line:
**one honest session always completes** — even the maximal shape fits at
86.5% with a tail for user-initiated retries — while sustained heavy use
(two thorough sessions in an hour, 1,230) throttles. The originally
planned 500/hr failed that test: the thorough session hit 123% mid-way,
walling a user for doing exactly what the UI invites.

The count limit's job is politeness and pipe-throttling, not cost
recovery. A full allowance costs $0.0003 in Worker requests; the
bandwidth vector is bounded per-request by the 50 MB / 20 MB caps and
the image-only content-type rejection, and that defence is unchanged by
this number. The tradeoff, named: doubling the allowance doubles what an
abuser extracts per IP before rotating — but IP rotation defeats any
per-IP number equally, so the marginal protection of 500-over-1,000 is
small while its cost falls on the thorough users the tool is for.

**What the model does not capture: one user per IP is an assumption.**
Shared egress — offices, universities, carrier-grade NAT — puts many
users behind one counter, so "two thorough sessions do not fit" can mean
two unrelated people on the same mobile network. Not a reason to change
the number, but it is the failure mode most likely to produce a confused
support message. The user-facing 429 copy must account for it: no
accusation ("you have made too many requests" indicts someone who may
have made three), state that the limit is shared by the network
connection, and say when it resets.

Related but deliberately NOT moving: `MEASURE_WARN_AT` stays at 200. Its
rationale is the size of the burst one click authorises, which does not
change when the budget does — at 500/hr it happened to coincide with
~40% of the allowance, and scaling it to restore that ratio would be
preserving a coincidence.

**Cost:** an abuser gets 1,000 proxied requests per IP per hour instead
of 500 before rotating; accepted against per-request byte caps and the
rotation argument above.
**Revisit if:** live telemetry shows sustained per-IP pipe use the byte
caps don't contain (lower it or split read/download budgets), or 429s
cluster on carrier ASNs (the shared-egress assumption bit real users —
finer keys are constrained by statelessness, so this needs design, not a
number tweak).

## Open questions

| Question | Trigger |
|---|---|
| Headless-browser deep scan | Closed 2026-08-10 — not indicated; see "Deep-scan mode closed" above |
| Sign-in or quotas | Only if abuse outpaces rate limits |
| Monetization | Not before real traffic exists |
| Open-sourcing the repo | Post-launch |