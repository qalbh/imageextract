// Landing-page gate. Every future landing change — the demo grid, the mobile
// pass — must pass this. Exits non-zero on any failure so it can gate CI.
//
// Self-contained: serves the built `dist/client` over the shared COMPRESSING
// static server (scripts/static-server.mjs — no workerd), so it needs no dev
// server and leaves no orphaned processes. Compression is not incidental: a
// plain static server understates the product, which is how this project
// carried a phantom 0.25s LCP regression for four days. The gate now asserts
// it. Run `astro build` first (the `verify:landing` npm script chains it).
//
// Browser: uses playwright-core, which ships NO browser. Provide one via
// CHROMIUM_PATH=/path/to/chromium, or have Google Chrome installed (the
// script falls back to channel:"chrome"). In CI: `npx playwright install
// chromium` and export CHROMIUM_PATH, or install Chrome.

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { createStaticServer } from './static-server.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// The landing page went from zero JS to a small demo script. That budget is
// now a hard cap the gate enforces (gzipped). No framework island either —
// this must stay vanilla, checked separately below.
const JS_BUDGET_GZIP = 8192;
const dist = join(root, 'dist', 'client');

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ---------------------------------------------------------------------------
// Static source checks — no browser, no build needed. This is the "no
// off-token values" gate; the numeric-scale rule is what caught `size-6`.
// ---------------------------------------------------------------------------
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(astro|tsx|ts)$/.test(entry.name)) out.push(p);
  }
  return out;
}

// Pre-restyle results-view files, still on the old neutral/numeric utilities.
// Their token migration is frontend-plan step 1; delete each entry here when
// it lands, so the gate then covers it (self-retiring, like doc-sync's
// allowlist). The whole of src/pages + src/components is now migrated onto
// tokens, so this set is empty — kept so a future pre-restyle file can be
// parked here again.
const PRE_RESTYLE = new Set([]);

async function sourceChecks() {
  const dirs = [join(root, 'src', 'pages'), join(root, 'src', 'components')];
  const all = (await Promise.all(dirs.filter(existsSync).map(walk))).flat();
  const files = all.filter((f) => !PRE_RESTYLE.has(f.replace(root + '/', '')));
  const hex = [];
  const arbitrary = [];
  const numericScale = [];
  const strayRadius = [];
  const HEX = /#[0-9a-fA-F]{3,8}\b/;
  const ARBITRARY = /(?:^|["\s:])-?[a-z][a-z-]*-\[[^\]]+\]/; // e.g. text-[11px], w-[3px]
  const NUMERIC = /\b(?:p|m|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|size|w|h|space-x|space-y|inset|top|bottom|left|right)-[0-9]+(?:\.[0-9]+)?\b/;
  // The radius set is sm/md/full ONLY (design-system.md). The @theme namespace
  // wipe means a stray alias generates no CSS at all — silently square — so
  // catch it here instead. rounded-full is allowed but currently unused in
  // markup (the toggle uses var(--radius-full) in CSS).
  const RADIUS = /\brounded-(?:xs|lg|xl|2xl|3xl)\b/;
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    text.split('\n').forEach((line, i) => {
      const at = `${f.replace(root + '/', '')}:${i + 1}`;
      if (HEX.test(line)) hex.push(`${at} ${line.trim().slice(0, 60)}`);
      if (ARBITRARY.test(line)) arbitrary.push(`${at} ${line.trim().slice(0, 60)}`);
      // `mt-0` / `inset-0` etc. are legitimate zero resets, not scale values.
      const m = line.match(NUMERIC);
      if (m && !/-0$/.test(m[0])) numericScale.push(`${at} ${m[0]}`);
      if (RADIUS.test(line)) strayRadius.push(`${at} ${line.match(RADIUS)[0]}`);
    });
  }
  ok('no hex values in src/pages + src/components', hex.length === 0, hex.join(' | '));
  ok('no arbitrary Tailwind utilities', arbitrary.length === 0, arbitrary.join(' | '));
  ok('no off-token numeric-scale utilities (caught size-6)', numericScale.length === 0, numericScale.join(' | '));
  ok('no radius aliases outside sm/md/full', strayRadius.length === 0, strayRadius.join(' | '));
}

// ---------------------------------------------------------------------------
// Transport + CSS-boundary checks. Both guard against silent regressions that
// a rendering check cannot see.
// ---------------------------------------------------------------------------

// The harness must compress, because production does. Asserted rather than
// assumed: serving `dist` uncompressed is exactly the mistake that produced
// four days of phantom LCP figures (see scripts/static-server.mjs).
async function transportChecks(base) {
  for (const [label, path] of [['/', '/'], ['the shared stylesheet', null]]) {
    const target = path ?? `/${(await (await fetch(base + '/')).text()).match(/_astro\/[A-Za-z0-9._-]+\.css/)[0]}`;
    const res = await fetch(base + target, { headers: { 'accept-encoding': 'gzip' } });
    const enc = res.headers.get('content-encoding');
    const wire = Number(res.headers.get('content-length'));
    const raw = (await res.arrayBuffer()).byteLength;
    ok(
      `${label} is served compressed`,
      enc === 'gzip' && wire > 0 && wire < raw,
      `content-encoding=${enc ?? 'none'}, ${wire}B on the wire vs ${raw}B raw`,
    );
  }
}

// The global sheet must carry nothing that only /results uses. It leaked once
// (every static page shipped the tile/grid/sheet rules) because Preact islands
// cannot use Astro's scoped <style>, so island CSS had no home but global.css.
// src/styles/results.css is that home; this keeps it there.
const RESULTS_ONLY = ['.results-grid', '.result-tile', '.filter-sheet', '.selection-bar', '.results-shell', '.skeleton-tile'];
async function cssBoundaryChecks(base) {
  const read = async (page) => {
    const html = await (await fetch(base + page)).text();
    const linked = [...html.matchAll(/href="(\/_astro\/[^"]+\.css)"/g)].map((m) => m[1]);
    const sheets = await Promise.all(linked.map(async (h) => (await fetch(base + h)).text()));
    const inline = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    return { linked: sheets.join('\n'), all: sheets.concat(inline).join('\n') };
  };
  // A static page: neither its linked sheets nor its inline styles may mention
  // the results view. This is the assertion that would have caught the leak.
  const priv = await read('/privacy');
  const leaked = RESULTS_ONLY.filter((s) => priv.all.includes(s));
  ok('/privacy ships no /results component CSS', leaked.length === 0, leaked.join(' ') || 'clean');
  // …and the rules must still reach the page that needs them.
  const results = await read('/results');
  const missing = RESULTS_ONLY.filter((s) => !results.all.includes(s));
  ok('/results still gets every results rule', missing.length === 0, missing.join(' ') || 'all present');
}

async function browserChecks(base) {
  const launch = process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : { channel: 'chrome' };
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage();

    // / JS budget: sum gzipped bytes of every inline + referenced script.
    const homeHtml = await (await fetch(base + '/')).text();
    let jsGzip = 0;
    const detail = [];
    for (const m of homeHtml.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      const attrs = m[1] || '';
      const srcMatch = attrs.match(/\ssrc=["']([^"']+)["']/);
      if (srcMatch) {
        const p = join(dist, srcMatch[1].split('?')[0]);
        if (existsSync(p)) {
          const g = gzipSync(await readFile(p)).length;
          jsGzip += g;
          detail.push(`${srcMatch[1]}=${g}`);
        }
      } else if (m[2].trim()) {
        const g = gzipSync(Buffer.from(m[2])).length;
        jsGzip += g;
        detail.push(`inline=${g}`);
      }
    }
    ok(
      `/ JS ≤ ${JS_BUDGET_GZIP}B gzipped`,
      jsGzip <= JS_BUDGET_GZIP,
      `${jsGzip}B gzipped [${detail.join(' ')}]`,
    );

    // Still no framework island — the demo is vanilla JS, not a hydrated island.
    await page.goto(base + '/', { waitUntil: 'load' });
    ok('/ DOM has zero astro-island elements', (await page.locator('astro-island').count()) === 0);

    // LCP element is the H1.
    const lcp = await page.evaluate(
      () =>
        new Promise((res) => {
          new PerformanceObserver((l) => {
            const e = l.getEntries().at(-1);
            if (e && e.element) res(e.element.tagName);
          }).observe({ type: 'largest-contentful-paint', buffered: true });
          setTimeout(() => res('TIMEOUT'), 4000);
        }),
    );
    ok('LCP element is the H1', lcp === 'H1', `got ${lcp}`);

    // Every in-page nav anchor resolves to an existing id (checked in-browser,
    // where document.getElementById is available).
    const unresolved = await page.evaluate(() =>
      [...new Set([...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href')))]
        .map((href) => href.slice(1))
        .filter((id) => id && !document.getElementById(id)),
    );
    ok('every nav anchor resolves to an id', unresolved.length === 0, unresolved.join(' '));

    // /results renders with the shared scan form.
    await page.goto(base + '/results', { waitUntil: 'load' });
    ok('/results renders the shared form (#scan-url)', (await page.locator('#scan-url').count()) === 1);

    // Demo intro on a cold desktop load: scrolling the band to ≥40% must
    // start the scripted intro (armed) and nothing incidental may abort it.
    // Diagnosed 2026-08-10: the machinery was fine; the phenotype "never
    // plays on desktop" traces to reduced-motion or played-unattended, and
    // pointerover (a boundary event that headed Chrome fires on scroll under
    // a resting pointer) was removed from the abort triggers. These checks
    // pin the verified behaviour.
    await page.goto(base + '/', { waitUntil: 'load' });
    await page.evaluate(() => {
      const demo = document.getElementById('demo');
      if (demo) scrollTo(0, demo.offsetTop - innerHeight * 0.25);
    });
    await page.waitForTimeout(1400);
    const intro = await page.evaluate(() => ({
      armed: document.querySelector('[data-grid]')?.classList.contains('armed') ?? false,
      replayHidden: document.querySelector('[data-replay]')?.hidden ?? null,
    }));
    ok('demo intro starts on a cold desktop load and is not aborted', intro.armed && intro.replayHidden === true, JSON.stringify(intro));

    // Reduced motion: the interactive end state, never the animation.
    const rmCtx = await browser.newContext({ reducedMotion: 'reduce' });
    const rm = await rmCtx.newPage();
    await rm.goto(base + '/', { waitUntil: 'load' });
    await rm.waitForTimeout(400);
    const rmState = await rm.evaluate(() => ({
      armed: document.querySelector('[data-grid]')?.classList.contains('armed') ?? false,
      jpegPressed: [...document.querySelectorAll('[data-chip]')]
        .find((c) => c.dataset.chip === 'jpeg')
        ?.getAttribute('aria-pressed'),
      replayVisible: document.querySelector('[data-replay]')?.hidden === false,
    }));
    // Interactivity of the end state: clicking All must reflow the chips.
    await rm.locator('[data-chip="all"]').click();
    const rmInteractive = (await rm.locator('[data-chip="all"]').getAttribute('aria-pressed')) === 'true';
    ok(
      'reduced motion: end state (filtered, replay offered) and still interactive',
      !rmState.armed && rmState.jpegPressed === 'true' && rmState.replayVisible && rmInteractive,
      JSON.stringify(rmState),
    );
    await rmCtx.close();

    // Narrow (phone-shaped) viewport still plays the intro.
    const mCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const m = await mCtx.newPage();
    await m.goto(base + '/', { waitUntil: 'load' });
    await m.evaluate(() => {
      const demo = document.getElementById('demo');
      if (demo) scrollTo(0, demo.offsetTop - innerHeight * 0.25);
    });
    await m.waitForTimeout(1400);
    const mobileArmed = await m.evaluate(
      () => document.querySelector('[data-grid]')?.classList.contains('armed') ?? false,
    );
    ok('demo intro still plays at phone widths', mobileArmed);
    await mCtx.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!existsSync(dist)) {
    console.error('dist/client not found — run `astro build` first (npm run verify:landing does this).');
    process.exit(1);
  }
  console.log('Landing verification');
  await sourceChecks();
  const server = await createStaticServer(dist);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await transportChecks(base);
    await cssBoundaryChecks(base);
    await browserChecks(base);
  } finally {
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
