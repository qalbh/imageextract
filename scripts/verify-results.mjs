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
    const fbFixture = {
      pageUrl: 'https://example.com/fb',
      images: Array.from({ length: FB_N }, (_, i) => ({
        id: `fb${i}`,
        url: `https://hotlink.test/fb-${i}.${i % 2 === 0 ? 'png' : 'webp'}`,
        filename: `fb-${i}`,
        ext: i % 2 === 0 ? 'png' : 'webp',
        source: 'img',
      })),
    };
    const directCounts = new Map();
    const proxyCounts = new Map();
    const SVG_BODY = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#888"/></svg>';

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
        const idx = Number(target.match(/fb-(\d+)/)?.[1] ?? -1);
        return idx % 2 === 0
          ? route.fulfill({
              status: 200,
              headers: { 'cache-control': 'private, max-age=3600' },
              contentType: 'image/svg+xml',
              body: SVG_BODY,
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
    await fb.close();
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
