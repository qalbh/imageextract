// Results-grid reveal + scale gate. Loads /results with a large fixture scan
// (injected by intercepting /api/scan — no production fixture backdoor), under
// a throttled CPU profile, and checks the incremental-reveal model:
//   - at rest, only the reveal cap of tiles is mounted (not the whole set)
//   - scrolling appends the rest
// Reports the DOM node count at rest so regressions in per-tile weight show up.
//
// Self-contained: serves the built dist/client over a plain static server and
// aborts all <img> loads so tiles fail fast without hitting the network. Run
// `astro build` first (the `verify:results` npm script chains it).
//
// Browser: playwright-core ships NO browser. Provide one via CHROMIUM_PATH, or
// have Google Chrome installed (falls back to channel:"chrome").

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, dirname } from 'node:path';
import { chromium } from 'playwright-core';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist', 'client');

// Must match TILE_REVEAL_CAP in src/lib/results-model.ts.
const REVEAL_CAP = 120;
const FIXTURE_N = 220;
const CPU_THROTTLE = 4; // 4× slower than the reference device
// Body served for recovered thumbnails AND real-HTTP download emulation.
const FB_SVG_BODY = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#888"/></svg>';

// HEAD-probe emulation state (probing scenario). Targets encode their
// behaviour in the filename: sz-<i>-<bytes>.png answers Content-Length
// <bytes>; "nolen" answers 200 without a length; "err" answers 502; "slow"
// delays long enough to be canceled mid-flight. Peak concurrency is tracked
// server-side to assert the queue's cap.
const probeStats = { counts: new Map(), active: 0, peak: 0 };
// Inline-GET arrivals per proxy target (ZIP member fetches) — lets the gate
// assert that a dismissed picker costs ZERO subrequests.
const getCounts = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function makeFixture(n) {
  const exts = ['png', 'jpeg', 'webp', 'svg', 'gif'];
  const sources = ['img', 'srcset', 'stylesheet', 'inline-svg', 'meta'];
  const images = [];
  for (let i = 0; i < n; i += 1) {
    const ext = exts[i % exts.length];
    const source = sources[i % sources.length];
    // Half carry declared dimensions, so width-sort and the known-count have
    // something to chew on.
    const dims = i % 2 === 0 ? { width: 200 + i, height: 100 + i } : {};
    images.push({ id: `t${i}`, url: `https://example.com/img-${i}.${ext}`, filename: `img-${i}`, ext, source, ...dims });
  }
  return { pageUrl: 'https://example.com/', images };
}

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.json': 'application/json', '.png': 'image/png',
};
function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const p = decodeURIComponent((req.url || '/').split('?')[0]);
        // Download emulation for the fallback/download scenario: Chromium
        // cancels downloads served from Playwright route.fulfill, so
        // download=1 proxy requests must travel real HTTP. Mirrors the real
        // proxy's shape: attachment disposition named from the target's URL
        // path (which must WIN over the anchor's download attribute).
        if (p === '/api/proxy') {
          const q = new URL(req.url, 'http://x').searchParams;
          const target = q.get('url') ?? '';
          const name = target.split('/').filter(Boolean).pop() ?? 'image';
          if (req.method === 'HEAD') {
            probeStats.counts.set(target, (probeStats.counts.get(target) ?? 0) + 1);
            probeStats.active += 1;
            probeStats.peak = Math.max(probeStats.peak, probeStats.active);
            await sleep(name.includes('slow') ? 4000 : 120);
            probeStats.active -= 1;
            if (name.includes('err')) {
              res.statusCode = 502;
            } else {
              res.setHeader('content-type', 'image/png');
              const m = name.match(/sz-\d+-(\d+)/);
              // "nolen" (and anything unmatched) sends no Content-Length —
              // the 'unknown-length' case. Node adds none for HEAD unless set.
              if (m && !name.includes('nolen')) res.setHeader('content-length', m[1]);
            }
            res.end();
            return;
          }
          // GET path: "err" targets 502 (ZIP failure-skip); "slow" targets
          // stall long enough to cancel mid-assembly.
          getCounts.set(target, (getCounts.get(target) ?? 0) + 1);
          if (name.includes('err')) {
            res.statusCode = 502;
            res.end('upstream error');
            return;
          }
          if (name.includes('slow')) await sleep(4000);
          res.setHeader('content-type', 'image/svg+xml');
          res.setHeader('cache-control', 'private, max-age=3600');
          if (q.get('download') === '1') {
            res.setHeader('content-disposition', `attachment; filename="${name}"`);
          }
          res.end(FB_SVG_BODY);
          return;
        }
        let file = join(dist, p);
        if (existsSync(file) && (await stat(file)).isDirectory()) file = join(file, 'index.html');
        else if (!existsSync(file)) {
          const asDir = join(dist, p, 'index.html');
          file = existsSync(asDir) ? asDir : file;
        }
        if (!existsSync(file)) { res.statusCode = 404; res.end('not found'); return; }
        res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
        res.end(await readFile(file));
      } catch { res.statusCode = 500; res.end('err'); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  if (!existsSync(dist)) {
    console.error('dist/client not found — run `astro build` first (npm run verify:results does this).');
    process.exit(1);
  }
  console.log(`Results-grid verification (${FIXTURE_N} tiles, ${CPU_THROTTLE}× CPU throttle)`);

  const fixture = makeFixture(FIXTURE_N);
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const launch = process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : { channel: 'chrome' };
  const browser = await chromium.launch(launch);

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    // Fail image loads fast (no network); fulfill the scan with the fixture.
    await page.route('**/*', (route) =>
      route.request().resourceType() === 'image' ? route.abort() : route.continue(),
    );
    await page.route('**/api/scan*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }),
    );

    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

    const t0 = Date.now();
    await page.goto(`${base}/results?url=${encodeURIComponent('https://example.com/')}`, { waitUntil: 'load' });
    await page.waitForSelector('li.result-tile', { timeout: 15000 });
    const firstTileMs = Date.now() - t0;

    const atRest = await page.locator('li.result-tile').count();
    const domNodes = await page.evaluate(() => document.querySelectorAll('*').length);
    ok(
      `at rest, only the reveal cap is mounted (≤ ${REVEAL_CAP})`,
      atRest <= REVEAL_CAP && atRest > 0,
      `${atRest} tiles mounted, ${domNodes} total DOM nodes, first tile in ${firstTileMs}ms`,
    );

    // "Showing X of Y" header reflects the reveal window, not the full set.
    const header = (await page.locator('text=/Showing \\d+ of \\d+/').first().textContent())?.trim();
    ok('header reports the reveal window', /Showing \d+ of \d+/.test(header || ''), header || '(missing)');

    // Scroll to append the rest.
    let mounted = atRest;
    for (let i = 0; i < 30 && mounted < FIXTURE_N; i += 1) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(250);
      mounted = await page.locator('li.result-tile').count();
    }
    ok('scrolling reveals the whole filtered set', mounted >= FIXTURE_N, `${mounted}/${FIXTURE_N} after scroll`);

    console.log(
      `\n  reveal: ${atRest} at rest → ${mounted} after scroll · ${domNodes} DOM nodes at rest · first tile ${firstTileMs}ms @ ${CPU_THROTTLE}× CPU`,
    );

    // -----------------------------------------------------------------------
    // Fallback scenario — proves retry-once ACROSS REMOUNTS, the property the
    // suite cannot test (no DOM in workerd). 8 tiles whose direct loads all
    // fail: even (png) recover through the proxy, odd (webp) die there too.
    // The PNG→All filter round trip unmounts and remounts the DEAD webp
    // tiles, so the zero-new-requests assertions are pure client logic
    // (dead tiles mount no img; nothing re-attempts the origin) — they do
    // not depend on caching. Remounting a RECOVERED tile is the one path
    // this scenario does not exercise: that re-request is absorbed by the
    // real proxy's cache-control (see the load-bearing note at proxy.ts),
    // which route-fulfilled responses can't reliably emulate.
    // -----------------------------------------------------------------------
    const FB_N = 8;
    const DATA_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="15" fill="#4a5"/></svg>';
    const DATA_URI = `data:image/svg+xml,${encodeURIComponent(DATA_SVG)}`;
    const fbFixture = {
      pageUrl: 'https://example.com/fb',
      images: [
        ...Array.from({ length: FB_N }, (_, i) => ({
          id: `fb${i}`,
          url: `https://hotlink.test/fb-${i}.${i % 2 === 0 ? 'png' : 'webp'}`,
          filename: `fb-${i}`,
          ext: i % 2 === 0 ? 'png' : 'webp',
          source: 'img',
        })),
        // A data: URI tile (inline-svg style): downloads natively via the
        // download attribute, no proxy involvement.
        { id: 'fbdata', url: DATA_URI, filename: 'inline-1.svg', ext: 'svg', source: 'inline-svg' },
      ],
    };
    const directCounts = new Map();
    const proxyCounts = new Map();

    const fb = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await fb.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith('https://hotlink.test/')) {
        directCounts.set(u, (directCounts.get(u) ?? 0) + 1);
        return route.abort(); // the direct load always fails
      }
      if (u.includes('/api/proxy?')) {
        const target = new URL(u).searchParams.get('url') ?? '';
        proxyCounts.set(target, (proxyCounts.get(target) ?? 0) + 1);
        // download=1 must travel real HTTP (the static server emulates the
        // proxy) — Chromium cancels downloads served from route.fulfill.
        if (new URL(u).searchParams.get('download') === '1') return route.continue();
        const idx = Number(target.match(/fb-(\d+)/)?.[1] ?? -1);
        return idx % 2 === 0
          ? route.fulfill({
              status: 200,
              headers: { 'cache-control': 'private, max-age=3600' },
              contentType: 'image/svg+xml',
              body: FB_SVG_BODY,
            })
          : route.fulfill({ status: 502, contentType: 'text/plain', body: 'upstream error' });
      }
      return route.continue();
    });
    await fb.route('**/api/scan*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fbFixture) }),
    );
    await fb.goto(`${base}/results?url=${encodeURIComponent(fbFixture.pageUrl)}`, { waitUntil: 'load' });
    await fb.waitForSelector('li.result-tile', { timeout: 15000 });
    await fb.waitForTimeout(1200); // let error → retry → settle

    const onceEach = (map) => [...map.values()].every((n) => n === 1) && map.size === FB_N;
    ok(
      'fallback: exactly one proxy request per failed tile',
      onceEach(proxyCounts),
      `${proxyCounts.size} URLs probed, counts [${[...proxyCounts.values()].join(',')}]`,
    );
    const recovered = await fb.locator('li img[src*="/api/proxy"]').count();
    const dead = await fb.locator('text=preview unavailable').count();
    ok('fallback: recovered tiles render proxy images, dead tiles the message', recovered === FB_N / 2 && dead === FB_N / 2, `${recovered} recovered, ${dead} dead`);

    // Filter round trip: PNG-only unmounts the webp tiles; All remounts them.
    // Retry-once must hold: no new proxy requests (dead tiles mount no img;
    // recovered tiles cache-hit), and no direct-origin re-attempts either.
    await fb.locator('aside label', { hasText: 'PNG' }).locator('input').check();
    await fb.waitForTimeout(400);
    await fb.locator('aside label', { hasText: 'All' }).locator('input').check();
    await fb.waitForTimeout(800);
    ok(
      'fallback: filter round trip adds zero proxy and zero origin requests',
      onceEach(proxyCounts) && onceEach(directCounts),
      `proxy [${[...proxyCounts.values()].join(',')}], origin [${[...directCounts.values()].join(',')}]`,
    );
    const deadAfter = await fb.locator('text=preview unavailable').count();
    ok('fallback: dead tiles stay dead across the round trip', deadAfter === FB_N / 2, `${deadAfter} dead`);

    // -----------------------------------------------------------------------
    // Single-image download — captures REAL downloads (Chromium writes a temp
    // file we read back), so the anchor/download mechanics are verified, not
    // assumed. Runs after the count assertions above: a download adds a
    // deliberate, user-initiated proxy request.
    // -----------------------------------------------------------------------
    const anchors = await fb.locator('a[download]').count();
    const proxyAnchors = await fb.locator('a[download][href*="/api/proxy"]').count();
    ok(
      'download: every tile has an enabled anchor (proxy for http, self for data:)',
      anchors === FB_N + 1 && proxyAnchors === FB_N,
      `${anchors} anchors, ${proxyAnchors} via proxy`,
    );

    // Pointer download from a recovered tile: disposition name must win over
    // the anchor attribute, bytes must match, selection must not toggle.
    const tile0 = fb.locator('li', { hasText: 'fb-0' }).first();
    const pressedBefore = await tile0.getAttribute('aria-pressed');
    const [dl1] = await Promise.all([fb.waitForEvent('download'), tile0.locator('a[download]').click()]);
    const dl1Bytes = await readFile(await dl1.path(), 'utf8');
    ok(
      'download: click → real file, server disposition name wins, no selection toggle',
      dl1.suggestedFilename() === 'fb-0.png' &&
        dl1Bytes === FB_SVG_BODY &&
        (await tile0.getAttribute('aria-pressed')) === pressedBefore,
      `name=${dl1.suggestedFilename()}, ${dl1Bytes.length}B, pressed ${pressedBefore}→${await tile0.getAttribute('aria-pressed')}`,
    );

    // Keyboard: Enter on the focused anchor downloads and must NOT toggle the
    // tile (the tile's keydown handler ignores bubbled events).
    const tile2 = fb.locator('li', { hasText: 'fb-2' }).first();
    await tile2.locator('a[download]').focus();
    const [dl2] = await Promise.all([fb.waitForEvent('download'), fb.keyboard.press('Enter')]);
    ok(
      'download: Enter on the anchor downloads without toggling selection',
      dl2.suggestedFilename() === 'fb-2.png' && (await tile2.getAttribute('aria-pressed')) === 'false',
      `name=${dl2.suggestedFilename()}`,
    );

    // data: URI tile: downloads natively (no proxy request), named by the
    // anchor attribute since data: carries no headers.
    const proxyCountBefore = [...proxyCounts.values()].reduce((a, b) => a + b, 0);
    const dataTile = fb.locator('li', { hasText: 'inline-1.svg' }).first();
    const [dl3] = await Promise.all([fb.waitForEvent('download'), dataTile.locator('a[download]').click()]);
    const dl3Bytes = await readFile(await dl3.path(), 'utf8');
    const proxyCountAfter = [...proxyCounts.values()].reduce((a, b) => a + b, 0);
    ok(
      'download: data: URI downloads natively — attr name, exact bytes, zero proxy calls',
      dl3.suggestedFilename() === 'inline-1.svg' && dl3Bytes === DATA_SVG && proxyCountAfter === proxyCountBefore,
      `name=${dl3.suggestedFilename()}, ${dl3Bytes.length}B, proxy ${proxyCountBefore}→${proxyCountAfter}`,
    );
    await fb.close();

    // -----------------------------------------------------------------------
    // Byte-size probing — lazy, individually user-initiated, capped queue.
    // HEADs travel real HTTP (the server above), which also tracks peak
    // concurrency; thumbnails are aborted (their fallbacks too — irrelevant
    // here, only method HEAD is counted).
    // -----------------------------------------------------------------------
    const PR_N = 30;
    const prFixture = {
      pageUrl: 'https://example.com/probe',
      images: [
        ...Array.from({ length: PR_N }, (_, i) => {
          const marker = i === 7 ? 'nolen' : i === 8 ? 'err' : String((i + 1) * 100000);
          return {
            id: `sz${i}`,
            url: `https://probe.test/sz-${i}-${marker}.png`,
            filename: `sz-${i}-${marker}`,
            ext: 'png',
            source: 'img',
          };
        }),
        { id: 'prdata', url: DATA_URI, filename: 'inline-2.svg', ext: 'svg', source: 'inline-svg' },
      ],
    };
    probeStats.counts.clear();
    probeStats.peak = 0;
    const pr = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await pr.route('**/*', (route) =>
      route.request().resourceType() === 'image' ? route.abort() : route.continue(),
    );
    await pr.route('**/api/scan*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prFixture) }),
    );
    await pr.goto(`${base}/results?url=${encodeURIComponent(prFixture.pageUrl)}`, { waitUntil: 'load' });
    await pr.waitForSelector('li.result-tile', { timeout: 15000 });
    await pr.waitForTimeout(700);
    const headTotal = () => [...probeStats.counts.values()].reduce((a, b) => a + b, 0);
    ok('probing: zero HEADs on load and render', headTotal() === 0, `${headTotal()} HEADs`);

    // Single selection probes exactly that image; the cache survives
    // deselect + reselect.
    const przTile = (i) => pr.locator('li', { hasText: `sz-${i}-` }).first();
    await przTile(0).click();
    await pr.waitForTimeout(600);
    ok('probing: selecting one tile sends exactly one HEAD', headTotal() === 1, `${headTotal()} HEADs`);
    const bar1 = (await pr.locator('text=/1 selected/').first().textContent()) ?? '';
    ok('probing: bar shows the probed size', bar1.includes('100 KB'), bar1.trim().slice(0, 60));
    await przTile(0).click(); // deselect
    await przTile(0).click(); // reselect
    await pr.waitForTimeout(500);
    ok('probing: deselect + reselect re-probes nothing (cache)', headTotal() === 1, `${headTotal()} HEADs`);

    // Shift-range at or under the threshold auto-probes; a range above it
    // probes nothing and falls to Calculate size.
    await przTile(2).click();
    await przTile(6).click({ modifiers: ['Shift'] }); // span 5 ≤ 24
    await pr.waitForTimeout(900);
    ok('probing: small shift-range auto-probes its span', headTotal() === 6, `${headTotal()} HEADs (1 + 5)`);
    await przTile(0).click(); // toggles sz0 OFF, sets the anchor
    await przTile(29).click({ modifiers: ['Shift'] }); // span 30 > 24
    await pr.waitForTimeout(600);
    const calcButton = pr.getByRole('button', { name: /Calculate size/ });
    ok(
      'probing: oversized shift-range probes nothing and offers Calculate size',
      headTotal() === 6 && (await calcButton.count()) === 1,
      `${headTotal()} HEADs, button "${(await calcButton.textContent())?.trim()}"`,
    );

    // Calculate size probes the rest through the capped queue; the bar names
    // the unknowns instead of undercounting.
    await calcButton.click();
    await pr.waitForTimeout(3000);
    const eachOnce = [...probeStats.counts.values()].every((n) => n === 1);
    ok(
      'probing: Calculate size probes each remaining image once, peak ≤ 6',
      probeStats.counts.size === PR_N && eachOnce && probeStats.peak <= 6 && probeStats.peak >= 2,
      `${probeStats.counts.size} targets, peak ${probeStats.peak}`,
    );
    const barFinal = (await pr.locator('text=/30 selected/').first().textContent()) ?? '';
    ok(
      'probing: total is honest — sum plus named unknowns',
      barFinal.includes('44.8 MB') && barFinal.includes('+ 2 unknown'),
      barFinal.trim().slice(0, 80),
    );

    // data: URI sizes are computed locally — no HEAD.
    await pr.locator('li', { hasText: 'inline-2.svg' }).first().click();
    await pr.waitForTimeout(300);
    ok('probing: data: URI sizes locally with zero HEADs', headTotal() === PR_N, `${headTotal()} HEADs`);
    await pr.close();

    // Cancel: slow probes, cancel mid-flight, counts freeze and the action
    // returns. Only the admitted batch (≤ concurrency cap) ever reaches the
    // server; canceled pending probes never do.
    const SLOW_N = 8;
    const slowFixture = {
      pageUrl: 'https://example.com/slow',
      images: Array.from({ length: SLOW_N }, (_, i) => ({
        id: `sl${i}`,
        url: `https://probe.test/slow-${i}.png`,
        filename: `slow-${i}`,
        ext: 'png',
        source: 'img',
      })),
    };
    probeStats.counts.clear();
    probeStats.peak = 0;
    const sl = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await sl.route('**/*', (route) =>
      route.request().resourceType() === 'image' ? route.abort() : route.continue(),
    );
    await sl.route('**/api/scan*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(slowFixture) }),
    );
    await sl.goto(`${base}/results?url=${encodeURIComponent(slowFixture.pageUrl)}`, { waitUntil: 'load' });
    await sl.waitForSelector('li.result-tile', { timeout: 15000 });
    await sl.getByRole('button', { name: /Select all/ }).click();
    await sl.waitForTimeout(400);
    ok('probing: select-all probes nothing', headTotal() === 0, `${headTotal()} HEADs`);
    await sl.getByRole('button', { name: /Calculate size/ }).click();
    await sl.waitForSelector('text=/sizing \\d+/', { timeout: 5000 });
    await sl.getByRole('button', { name: 'Cancel' }).click();
    await sl.waitForTimeout(400);
    const frozen = headTotal();
    await sl.waitForTimeout(1500);
    ok(
      'probing: Cancel freezes the burst — only the admitted batch reached the server',
      headTotal() === frozen && frozen <= 6 && frozen < SLOW_N && (await sl.getByRole('button', { name: /Calculate size/ }).count()) === 1,
      `${frozen} of ${SLOW_N} HEADs arrived, none after cancel`,
    );
    await sl.close();

    // -----------------------------------------------------------------------
    // ZIP assembly — real downloads parsed from disk. Headless has no
    // showSaveFilePicker, so this exercises the Blob + object-URL path (the
    // path every phone takes). Object-URL hygiene is instrumented.
    // -----------------------------------------------------------------------
    const eocdCount = (buf) => {
      for (let i = buf.length - 22; i >= 0; i -= 1) {
        if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
          return buf.readUInt16LE(i + 10);
        }
      }
      return -1;
    };
    const zipFixture = (n, mutate = (x) => x) => ({
      pageUrl: 'https://example.com/zip',
      images: Array.from({ length: n }, (_, i) =>
        mutate({
          id: `zf${i}`,
          url: `https://probe.test/zf-${i}.png`,
          filename: `zf-${i}.png`,
          ext: 'png',
          source: 'img',
        }, i),
      ),
    });

    async function zipPage(fixture) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.addInitScript(() => {
        // Headless desktop Chromium HAS showSaveFilePicker but rejects it
        // (no real picker) — which the app correctly treats as a dismissed
        // picker and stops. Remove it so the gate exercises the Blob path,
        // i.e. what every phone and Firefox run.
        delete window.showSaveFilePicker;
        window.__urls = { created: 0, revoked: 0 };
        const c = URL.createObjectURL.bind(URL);
        const r = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = (o) => {
          window.__urls.created += 1;
          return c(o);
        };
        URL.revokeObjectURL = (u) => {
          window.__urls.revoked += 1;
          return r(u);
        };
      });
      await page.route('**/*', (route) =>
        route.request().resourceType() === 'image' ? route.abort() : route.continue(),
      );
      await page.route('**/api/scan*', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }),
      );
      await page.goto(`${base}/results?url=${encodeURIComponent(fixture.pageUrl)}`, { waitUntil: 'load' });
      await page.waitForSelector('li.result-tile', { timeout: 15000 });
      return page;
    }

    // Happy-with-failures path: 8 members, 2 dead upstream.
    const zp = await zipPage(
      zipFixture(8, (img, i) =>
        i >= 6 ? { ...img, url: `https://probe.test/zf-${i}-err.png`, filename: `zf-${i}-err.png` } : img,
      ),
    );
    await zp.getByRole('button', { name: /Select all/ }).click();
    const [zdl] = await Promise.all([
      zp.waitForEvent('download'),
      zp.getByRole('button', { name: 'Download ZIP' }).first().click(),
    ]);
    const zipBuf = await readFile(await zdl.path());
    ok(
      'zip: real archive lands — 6 members + SKIPPED.txt, failures named inside',
      zdl.suggestedFilename() === 'example.com.zip' &&
        eocdCount(zipBuf) === 7 &&
        zipBuf.includes('SKIPPED.txt') &&
        zipBuf.includes('zf-6-err.png\thttp-502'),
      `${zdl.suggestedFilename()}, ${eocdCount(zipBuf)} entries, ${zipBuf.length}B`,
    );
    await zp.waitForTimeout(1500);
    const zipBar = (await zp.locator('text=/ZIP saved/').first().textContent().catch(() => '')) ?? '';
    const urls = await zp.evaluate(() => window.__urls);
    ok(
      'zip: completion line reports skips AND names the write path; URLs revoked 1:1',
      zipBar.includes('6 of 8') &&
        zipBar.includes('(2 skipped)') &&
        zipBar.includes('via browser') &&
        urls.created === urls.revoked &&
        urls.created > 0,
      `"${zipBar.trim()}", urls ${urls.created}/${urls.revoked}`,
    );
    await zp.close();

    // Dismissed-picker branch — the headless quirk turned into coverage:
    // headless desktop Chromium HAS showSaveFilePicker but rejects it, which
    // is indistinguishable from a user dismissing the dialog. Leave the API
    // in place: the click must produce no download, no assembly, and ZERO
    // member subrequests (the picker runs before assembly for exactly this).
    const zd = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await zd.route('**/*', (route) =>
      route.request().resourceType() === 'image' ? route.abort() : route.continue(),
    );
    const zdFixture = zipFixture(4);
    await zd.route('**/api/scan*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(zdFixture) }),
    );
    await zd.goto(`${base}/results?url=${encodeURIComponent(zdFixture.pageUrl)}`, { waitUntil: 'load' });
    await zd.waitForSelector('li.result-tile', { timeout: 15000 });
    getCounts.clear();
    let zdDownloads = 0;
    zd.on('download', () => {
      zdDownloads += 1;
    });
    await zd.getByRole('button', { name: /Select all/ }).click();
    await zd.getByRole('button', { name: 'Download ZIP' }).first().click();
    await zd.waitForTimeout(800);
    ok(
      'zip: dismissed/rejected picker → no download, no assembly, zero member fetches',
      zdDownloads === 0 &&
        getCounts.size === 0 &&
        (await zd.locator('text=/Zipping/').count()) === 0 &&
        (await zd.getByRole('button', { name: 'Download ZIP' }).first().isEnabled()),
      `${zdDownloads} downloads, ${getCounts.size} member GETs`,
    );
    await zd.close();

    // Cancel mid-assembly: slow members, cancel, no download ever starts.
    const zc = await zipPage(
      zipFixture(6, (img, i) => ({ ...img, url: `https://probe.test/zf-${i}-slow.png`, filename: `zf-${i}-slow.png` })),
    );
    let zcDownloads = 0;
    zc.on('download', () => {
      zcDownloads += 1;
    });
    await zc.getByRole('button', { name: /Select all/ }).click();
    await zc.getByRole('button', { name: 'Download ZIP' }).first().click();
    await zc.waitForSelector('text=/Zipping/', { timeout: 5000 });
    const cancelZip = zc.getByRole('button', { name: 'Cancel (discards ZIP)' });
    ok('zip: the cancel control names its consequence BEFORE the click', (await cancelZip.count()) === 1);
    await cancelZip.click();
    await zc.waitForTimeout(1500);
    ok(
      'zip: cancel mid-assembly → no download event, UI back to idle',
      zcDownloads === 0 &&
        (await zc.locator('text=/Zipping/').count()) === 0 &&
        (await zc.getByRole('button', { name: 'Download ZIP' }).first().isEnabled()),
      `${zcDownloads} downloads after cancel`,
    );
    await zc.close();

    // Cap boundary: 251 selected → blocked with the stated reason, never
    // truncated.
    const zx = await zipPage(zipFixture(251));
    await zx.getByRole('button', { name: /Select all/ }).click();
    await zx.waitForTimeout(400);
    ok(
      'zip: over the cap → Download ZIP blocked with the reason stated',
      !(await zx.getByRole('button', { name: 'Download ZIP' }).first().isEnabled()) &&
        (await zx.locator('text=/ZIP capped at 250 images/').count()) > 0,
      '251 selected',
    );
    await zx.close();
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
