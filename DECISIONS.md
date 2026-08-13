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
`ImageExtract` (then `ImageExtractBot`) is precisely what bot walls key on, so honesty makes us
*more* wallable than a UA-spoofing competitor. That is the values choice
already made ("robots.txt respected, no override" — same reasoning:
impersonating a browser to defeat an origin's stated wishes is the thing
we decided not to be). The number now sits next to the choice: it costs
us the walled giants, and it costs everyone else those too.

**Reinforced 2026-08-12 by the first production scan**, which looked at
first like a counter-example and is the opposite. behance.net returned
zero images from the deployed Worker and 128 from a laptop — *the same
static parse, of the same page, in the same minute, with the same code*.
Nothing about JavaScript differed between those two scans; only the
egress IP did. That is the cleanest demonstration this project has that
the boundary is the wall, not the parser: a headless browser would meet
the identical wall from the identical egress, at far greater cost, and
return the identical zero. An empty result therefore says nothing about
whether a deep scan would have helped — which is exactly why the revisit
condition below is written in terms of *readable* pages.

**Cost:** JS-only galleries (an app-shell page whose HTML holds no images)
still scan empty, and walled origins scan empty or thin.
**Revisit if:** live-scan telemetry shows a class of *readable* pages with
a large truly-absent residue — that would mean the corpus was
unrepresentative, not that the walls moved. A page that scans empty from
production and non-empty from anywhere else is a WALL, not evidence for
this revisit; check a second vantage before counting it.

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

**Tracked:** STATUS → Collapse variant sets in the grid

A decision that creates work names the box that carries it, and doc-sync
layer 6 asserts the named box exists in STATUS. Added 2026-08-12 after this
very entry produced three days of invisible work: "owed, not optional" was
recorded here and in AGENTS.md, and appeared in no checklist, so every
"what remains" list built from STATUS omitted it. Recording that something
is owed is not the same as tracking it.

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

## The hourly allowance is a budget the platform cannot enforce exactly

Found while building the limiter (2026-08-10): the 1,000/hour number was
chosen against the session model **before checking what the platform can
enforce**. Cloudflare's Rate Limiting binding offers only 10- and
60-second windows; shaping 1,000/hour as ~17/minute would throttle a
legitimate 500-member ZIP mid-assembly — the exact user the number was
chosen to protect. So the hourly figure is not expressible as a platform
guarantee, and it must never be read as one.

Enforcement chosen: **in-isolate hourly counters**
(`src/lib/rate-limit.ts`) — fixed windows, one Map, zero persistence,
the DoH-cache precedent. Durable Objects were rejected: exact
enforcement bought with persistent state, for the least security-critical
control in the system. The looseness is the point, and it COMPOUNDS:
fixed windows allow a boundary straddle, each isolate counts
independently, and isolate recycling forgets history mid-window — the
three multiply, so the 2–5× steady-state estimate for a real user is an
estimate, not a ceiling, and no hard ceiling exists. That is the correct
failure direction for a politeness control: looser for legitimate users,
while a deliberately distributed abuser was never going to be held by
any per-IP number (rotation defeats exact counters equally).

Keys derive from `CF-Connecting-IP`, which the edge sets and clients
cannot spoof through it. Absent header → fail open without counting
(dev, tests); the anomalous production case is surfaced by a static
`x-rate-limit: unenforced` response header — observable by an
operator's curl, logging nothing.

**Cost:** a determined single-IP user can exceed nominal by the
compounding factors above; accepted — politeness enforced approximately
is still politeness.
**Revisit if:** abuse telemetry shows the approximation exploited in
practice at damaging volume — the escalation path is the platform
binding for a per-minute *burst* cap layered under the hourly budget,
not Durable Objects.

## The domain blocklist reads from KV and fails open

Decided 2026-08-10. "Editable without redeploy" rules out a source
constant, so the list lives in KV — the second carve-out from the
zero-persistence rule, and the distinction is what keeps the rule
intact: **zero persistence targets retention of USER data.** The
blocklist is operator-authored, holds no user data, and the Worker only
ever READS it, so the done-when box "Nothing written to KV" stays
literally true. A future reader seeing "KV" in wrangler.jsonc should
conclude the rule held, not that it was broken.

Matching is the BROAD reading, deliberately: an entry blocks the host
and every subdomain (dot-boundary suffix, IDN punycoded, full-URL
pastes forgiven at parse) — because an operator adding a domain during
an abuse response assumes the broad reading, and a narrow or
silently-dropped entry fails for the exact case it was added for.
Enforcement lives inside safeFetch beside the SSRF guard's per-hop
checks: one integration point covers both endpoints, every redirect
hop, robots, and stylesheet fetches, and blocks cost zero subrequests
(checked before DoH). Image URLs on a blocked host keep dying after a
scan — the proxy re-checks on every call.

Fail-open, and the asymmetry with SSRF/DoH is principled, not
inconsistent: those are security and fail closed; this is politeness
and fails open — a KV blip must not take the tool down. Absent binding
(dev, tests) reads as an empty list for the same reason.

The list is ENUMERABLE, deliberately: a distinct `domain-blocked` 403
lets anyone probe it one domain per scan. Chosen because (a) the
alternative is lying — an indistinguishable error violates the
no-catch-all taxonomy and robs the site owner who asked out of
confirming it worked, which is the entire courtesy; (b) the contents
are not secrets — an owner knows they asked, an abuser learns on the
next attempt regardless of wording; (c) enumeration is already
throttled by the scan limiter and reveals nothing security-relevant,
because the blocklist is politeness — the SSRF guard, not this list,
protects infrastructure.

Propagation: an edit is live worldwide within roughly two minutes (KV
eventual consistency ≤60s typical + the 60s in-isolate cache TTL) —
written down so an incident responder treats a block as done two
minutes after the save, not at the save.

**Cost:** every request pays a cache lookup and each isolate one KV
read per minute; a site's images mirrored on a third-party CDN are not
covered (the list is host-scoped, not site-scoped — block the CDN host
if it asks).
**Revisit if:** the list outgrows a single KV value (~thousands of
entries is still fine) or an owner asks for path-level exclusion,
which robots.txt already provides and we already honour.

## Platform limits sit outside the error taxonomy — accepted

The wrangler `limits` block (cpu_ms 30,000 / subrequests 100, 2026-08-10)
terminates an invocation at the platform level. The user then gets
whatever Cloudflare returns — the catch-all the no-catch-all convention
exists to prevent, with no typed error and no honest copy. Accepted
rather than left unexamined, because both limits are sized to be
UNREACHABLE by honest traffic (cpu_ms carries ~19× the measured local
worst case with the hardware assumption stated in wrangler.jsonc;
subrequests ~1.6× the derived structural worst): a firing limit means a
logic bug, and a bug's failure mode does not deserve a friendly message
more than it deserves being fixed.

The one sharp case was CHECKED, not reasoned about: a proxy stream
killed mid-transfer severs the connection — harsher than the stream
error the truncation contract was proved against. Probed (2026-08-10,
socket-destroy mid-body against real Chrome): the browser still
discards the partial file and marks the download failed ("canceled",
no path). The truncation contract holds under the platform-kill
analogue; its claim needs no narrowing. Residual honesty: a real
Cloudflare kill cannot be produced locally, but at the transport layer
it is one of the two shapes probed (clean stream error, hard reset),
and both discard.

**Cost:** if a limit ever fires, the user sees a raw platform error.
**Revisit if:** limit-fire telemetry ever shows honest traffic hitting
either number — that means the sizing assumption broke, not that the
taxonomy needs a row.

## The User-Agent presents as a user-directed fetch, not a crawler

Decided 2026-08-10, with the /traffic page (the renamed Phase 5 hard
blocker):
`Mozilla/5.0 (compatible; ImageExtract/1.0; +https://imageextract.pics/traffic)`.

The `Mozilla/5.0 (compatible; …)` prefix is the convention for
legitimate non-browser agents, and this tool is a USER-DIRECTED fetch —
one page a person explicitly pasted, no link-following, no schedule, no
image fetching during the scan — not a crawler, so the string reads
that way. The path is `/traffic`, not `/bot`, because "bot"
mischaracterises what this does; nothing was deployed, so the rename
cost one string.

What keeps this honest: the tool stays NAMEABLE. robots.txt rules for
`ImageExtract` still work and there is still no override — that is
what separates presenting-as-what-we-are from disguising as a browser,
which was rejected for the same reason the fabricated Referer was
("The proxy stays referrerless": impersonating a browser context to
defeat an origin's stated wishes is the thing we decided not to be).

Two costs, named so neither gets undone or re-litigated blind:

**The Mozilla prefix may mislead naive log tools** into bucketing us
as a browser. Accepted because the product token stays present and
greppable in the parenthetical — the standard place legitimate agents
identify themselves. Someone auditing this later asking "why does a
non-browser send Mozilla/5.0?" — this is why, and it is deliberate.

**Version-suffix matching is a silent failure a site owner can
plausibly hit.** A robots rule written `User-agent: ImageExtract/1.0`
matches nothing — correct per spec (group names match by equality, no
version parsing), test-pinned, and exactly the mistake someone makes
copying the string out of their logs. Combined with /traffic
deliberately not mentioning robots.txt at all, the two failure modes
STACK: the mis-written rule fails silently, and nothing we publish
tells the owner that robots is honoured or how to name us. This is an
argument for reconsidering the page's robots silence later, not now —
recorded so the reconsideration has both halves in front of it rather
than one.

**Cost:** as above — naive log bucketing, and the stacked silent modes.
**Revisit if:** abuse-address traffic shows site owners discovering the
robots rule failed, or asking how to block us — either is the signal
that /traffic needs the robots paragraph after all.

## Releases are a direct wrangler deploy, not deploy-on-push

Decided 2026-08-12, at the first deploy: releases go out with
`npm run build && npx wrangler deploy` from a local machine, after the
verification gates pass. Cloudflare's Git integration (build-and-deploy
on push to `main`) is deliberately NOT wired up.

**The gates cannot run where a push-triggered build runs.**
`verify-landing.mjs` and `verify-results.mjs` drive a real Chromium
through playwright-core — 50 checks that exist precisely because they
catch what unit tests cannot: that the LCP element is the H1, that the
reveal cap holds at 220 tiles under CPU throttle, that a cancelled ZIP
downloads nothing, that `/privacy` ships no results CSS. Cloudflare's
build environment would not run them. Deploy-on-push would therefore
ship code that never passed the gates this project spent phases
building, and the gates would degrade into something run when someone
remembers. Direct deploy inverts that: what is live is always something
that already passed.

**The build output has been audited, and the audit only means something
if it keeps being the same build.** What ships was measured at the first
deploy, not assumed — 38 files, all from `dist/client`, zero `.md`,
`.ts`, `.astro`, `.test.*` or `.map`, with the 46-vs-38 discrepancy
reconciled (six directories, plus `_headers` and `.assetsignore`
consumed rather than served). Deploy-on-push moves that build to a
machine nobody inspects.

**A push should stay a smaller commitment than a release.** With
deploy-on-push every commit to `main` is live. That is wrong for a site
whose failure mode is a broken scanner — and this repo commits freely
mid-investigation (falsified hypotheses, reverted experiments, probe
entries). Those are commits that should never have been releases.

**Cost:** a manual step per release, and the deploying machine must
have wrangler authenticated — so releases are gated on one operator's
laptop rather than on CI. Accepted while that operator is the only one.
The middle path, if the friction ever costs more than it buys, is
deploy-on-push wired to a PRODUCTION BRANCH rather than `main`:
automation without every commit being a release. That is the first
thing to reach for, not full CI.

**Revisit if:** there is more than one operator (the authenticated-laptop
bottleneck becomes a bus factor), or releases become frequent enough
that the manual step is the bottleneck rather than the safety.

## The landing-page funnel carries its filter through the click

Decided 2026-08-12, before the first /tools page was written rather than
after, so the copy could promise what the funnel delivers.

`/results` accepted exactly one query param, `url`. A page titled
"Download all PNG images from a website" would therefore have handed off
to an UNFILTERED grid, with copy reading "now use the Format filter" —
the promise breaking at the point of conversion, which is the worst
place for it to break. `?format=` and `?source=` now parse into the same
filter state the sidebar drives (`parseFormatParam` / `parseSourceParam`
in `results-model.ts`, carried by hidden inputs on the existing native
GET form, so the funnel stays zero-JS).

The pre-applied filter is deliberately ORDINARY STATE, not a mode: the
sidebar renders PNG ticked and the visitor can untick it. A hidden
filter would be a grid that silently lies about what the page contains
— the same misrepresentation the variantGroup work exists to fix.

Parsing fails SILENT and OPEN. An unrecognised value is dropped; an
all-unrecognised param yields an empty set, which means no constraint,
so a stale or mistyped link shows the whole grid rather than an error or
an empty one. A bad landing-page link must never look like a failed
scan. `jpg` is accepted for `jpeg` because that is the label the UI
shows and therefore the spelling copy and URLs will use; the param
vocabulary for `source=` is the BUCKET ids only, not raw `ImageSource`
values, so there is one vocabulary rather than two.

The canonical-surface objection was raised and is weaker than it looks:
`/results` is already `noindex, nofollow`, `Disallow: /results` in
robots.txt, excluded from the sitemap, and canonical to the bare path,
so no crawler reaches a param. The param space is for humans arriving
from a page we wrote.

**Cost:** two more entry points into island state, so a future filter
control has a URL contract to keep. Bounded by the parsers being pure
and unit-tested (13 cases incl. every canonical format and group id, so
no sidebar row is unreachable by link).
**Revisit if:** a variant page ever needs a filter dimension the sidebar
does not have — that is a UI decision first, a param second, in that
order.

## Google Search Console yes, Web Analytics no — and the asymmetry is the point

Decided 2026-08-12. Search Console is verified by a DNS TXT record. It
injects nothing into any page, runs no script, sets no cookie, and
observes no visitor: it reports GOOGLE's own logs of queries that
already happened in Google's product. /privacy's sentence — "We use no
analytics, advertising, or tracking services" — is about services
running on this site observing the people who visit it, and Search
Console is none of those.

**Recorded because it will otherwise read as inconsistent with the Web
Analytics closure**, decided the same day in the other direction. The
distinction is mechanical, not a matter of degree: Web Analytics put a
`beacon.min.js` into all seven pages and made that sentence false on the
live site for roughly an hour. Search Console adds a DNS record and
reads a log we do not own. One changes what a visitor's browser does;
the other does not touch the visitor at all. doc-sync layer 5 sees no
difference — it greps shipped source for analytics markers, and a DNS
record is not source — which is exactly why the reasoning belongs here
rather than resting on a green suite.

It is also load-bearing rather than optional. With Web Analytics closed,
Search Console is the ONLY feedback channel left, and Phase 8's "expand
landing pages based on actual search queries" has no other input. The
first five /tools pages are an experiment spread across three axes
precisely because we cannot yet measure which axis earns pages; without
Search Console, pages 6–60 are guesses with no correction mechanism.

**Cost:** Google learns which queries we appear for — which Google
already knows, being the party that served them. No visitor-side cost,
which is the whole distinction.
**Revisit if:** verification ever requires an HTML file or a script tag
instead of a DNS record — that would change the mechanism, and the
answer with it.

## Numeric filename prefixes in the ZIP: closed as not-doing

Decided 2026-08-13, closing the last Phase 3 box. The idea was an optional
toggle that prefixed ZIP members with `001-`, `002-` so the archive preserved
the order tiles appeared in the grid. Recorded as a DECISION with the box
CHECKED, the deploy-on-push way — an unchecked box reads as owed work, and
this is not owed.

**It solves ordering, not collisions.** Filenames are already scan-unique:
`uniqueFilename` appends `-2`, `-3`… during extraction and data URIs become
`inline-N.svg`, so an archive cannot contain two members fighting over one
name. The problem a numeric prefix classically solves does not exist here.

**The ordering it preserves is weak.** Grid order is document order — where
an image sat in the page's markup. Users select the images they want; they
do not generally care that a photo was the fourteenth element in the DOM,
and nothing about document order survives into what they do with the files
afterwards.

**It costs UI surface in the wrong place.** The sidebar already carries
format, sort, source and display groups, with a selection bar beneath the
grid. Adding a preference control for filename cosmetics spends attention
budget on the least consequential thing on the screen, for a case nobody has
raised.

**Cost:** archives are ordered by whatever the user's file manager does with
the names, which for most selections is alphabetical rather than positional.
**Revisit if:** someone actually asks. That is the only evidence that would
justify it, and it is cheap to add later — the manifest filenames are already
what the archive uses, so a prefix is a string change at assembly time, not a
design.

## The legal pages ship without an outside review

Decided 2026-08-13, closing the last box that called itself a pre-launch
blocker. Recorded as a decision with the box CHECKED, the deploy-on-push
way — an unchecked box reads as owed work, and this is accepted rather
than owed.

**What is vouched for, and it is the larger half.** Every technical claim
on /privacy and /terms was verified against source before it was written,
and two were REPAIRED during that pass because the code did not support
them as drafted (selection triggers probes; the rate counters store the
endpoint class). The mechanisms those pages describe — 4 KB range probes,
hostname→verdict DNS caching at 60s, no-referrer on thumbnails, zero
cookie writes, upstream Set-Cookie stripped, nothing persisted — are
accurate descriptions of what the Worker does. The no-analytics sentence
is mechanically guarded by doc-sync layer 5. That part is not a matter of
opinion and does not need a lawyer.

**What is being accepted, stated plainly so nobody discovers it later.**
The legal FRAMING is unreviewed: the liability limitation, and the
takedown route. **The takedown route carries the real exposure**, because
the tool reaches material on sites we do not control — the copy commits
to a mechanism (write to support@, credible claims get the domain
excluded) whose adequacy as a response to a rights claim has never been
assessed by anyone qualified. The blocklist behind that promise works and
is live; whether the promise is the right one to make is the unreviewed
question.

The judgement: the pages are honest, the exposure is small at zero
traffic and zero revenue, and an outside read is a cost better spent when
there is something to protect.

**Cost:** if a claim arrives, the response is improvised against unreviewed
terms rather than prepared ones.
**Revisit if:** a takedown claim arrives, or the service takes on accounts,
payments, or data retention. Each of those changes the question rather
than merely raising the stakes — accounts and payments create obligations
these pages do not address at all, and retention would contradict the
sentence the whole privacy position rests on.

## Open questions

| Question | Trigger |
|---|---|
| Headless-browser deep scan | Closed 2026-08-10 — not indicated; see "Deep-scan mode closed" above |
| Sign-in or quotas | **Foreclosed 2026-08-10 by /about's published promise** ("there's no account, and there won't be one"). Accounts are not a feature we declined — the architecture makes them unnecessary: static parsing costs cents, so there is no per-scan compute to recover, which is the only reason competitors need signups. The abuse case this row reserved sign-in for is handled by rate limiting (1,000/hr, sized so one honest session always completes). If abuse ever outpaces that, the promise breaks PUBLICLY, in order: /about changes first, the feature comes second — the promise is what constrains, not an afterthought |
| Monetization | Not before real traffic exists |
| Open-sourcing the repo | Post-launch |