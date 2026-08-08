// Landing-page gate. Every future landing change — the demo grid, the mobile
// pass — must pass this. Exits non-zero on any failure so it can gate CI.
//
// Self-contained: serves the built `dist/client` over a plain static server
// (no workerd), so it needs no dev server and leaves no orphaned processes.
// Run `astro build` first (the `verify:landing` npm script chains it).
//
// Browser: uses playwright-core, which ships NO browser. Provide one via
// CHROMIUM_PATH=/path/to/chromium, or have Google Chrome installed (the
// script falls back to channel:"chrome"). In CI: `npx playwright install
// chromium` and export CHROMIUM_PATH, or install Chrome.

import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';

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
// allowlist). The landing surface (index.astro, ScanForm, Layout) is in scope.
const PRE_RESTYLE = new Set([
  'src/components/ResultsGrid.tsx',
  'src/components/ImageCard.tsx',
  'src/pages/results.astro',
]);

async function sourceChecks() {
  const dirs = [join(root, 'src', 'pages'), join(root, 'src', 'components')];
  const all = (await Promise.all(dirs.filter(existsSync).map(walk))).flat();
  const files = all.filter((f) => !PRE_RESTYLE.has(f.replace(root + '/', '')));
  const hex = [];
  const arbitrary = [];
  const numericScale = [];
  const HEX = /#[0-9a-fA-F]{3,8}\b/;
  const ARBITRARY = /(?:^|["\s:])-?[a-z][a-z-]*-\[[^\]]+\]/; // e.g. text-[11px], w-[3px]
  const NUMERIC = /\b(?:p|m|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|size|w|h|space-x|space-y|inset|top|bottom|left|right)-[0-9]+(?:\.[0-9]+)?\b/;
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    text.split('\n').forEach((line, i) => {
      const at = `${f.replace(root + '/', '')}:${i + 1}`;
      if (HEX.test(line)) hex.push(`${at} ${line.trim().slice(0, 60)}`);
      if (ARBITRARY.test(line)) arbitrary.push(`${at} ${line.trim().slice(0, 60)}`);
      // `mt-0` / `inset-0` etc. are legitimate zero resets, not scale values.
      const m = line.match(NUMERIC);
      if (m && !/-0$/.test(m[0])) numericScale.push(`${at} ${m[0]}`);
    });
  }
  ok('no hex values in src/pages + src/components', hex.length === 0, hex.join(' | '));
  ok('no arbitrary Tailwind utilities', arbitrary.length === 0, arbitrary.join(' | '));
  ok('no off-token numeric-scale utilities (caught size-6)', numericScale.length === 0, numericScale.join(' | '));
}

// ---------------------------------------------------------------------------
// Static file server over dist/client
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.json': 'application/json', '.png': 'image/png',
};
function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        let p = decodeURIComponent((req.url || '/').split('?')[0]);
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
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
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
