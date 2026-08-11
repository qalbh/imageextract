// The ONE way to serve `dist/client` outside workerd — for the verify gates
// and for any Lighthouse run.
//
// WHY THIS FILE EXISTS. Every Lighthouse figure this project recorded before
// 2026-08-11 was measured against `python -m http.server`, which sends
// everything UNCOMPRESSED. Cloudflare compresses by default, so the harness
// understated the product: the landing page's critical path measured ~61 KB
// instead of ~13 KB, and LCP read 2.2–2.3s instead of 2.03s. A quarter-second
// of phantom regression drove a font-subset experiment that could not have
// worked, and nearly drove a CSS-inlining one. Lighthouse had been reporting
// the cause all along — its `uses-text-compression` audit scored 0 with 50 KiB
// of named savings in every report — and nobody read that row.
//
// So the fix is structural, not attentional: there is now no uncompressed way
// to serve the build. Both gates import this, and `npm run serve:dist` is the
// documented entry point for a Lighthouse run. verify-landing additionally
// ASSERTS that what it received was compressed, so ripping this out fails a
// gate instead of quietly moving a number.
//
// Content negotiation mirrors Cloudflare: brotli when the client offers it,
// gzip otherwise, and only for text-ish types (compressing a PNG costs CPU
// and gains nothing). Binary bodies are passed through byte-exact, which is
// what verify-results' proxy emulation depends on.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

export const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.png': 'image/png',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};

// woff2 is already compressed internally; re-compressing it is the classic
// wasted round of CPU. Everything else text-shaped is worth it.
const COMPRESSIBLE = new Set([
  'text/html',
  'text/css',
  'text/javascript',
  'text/plain',
  'application/json',
  'application/xml',
  'image/svg+xml',
]);

/** Resolve a URL path to a file inside `dist`, following Astro's directory
 *  layout (`/privacy` → `privacy/index.html`). Returns null if nothing fits. */
export async function resolveFile(dist, urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0]);
  let file = join(dist, p);
  if (existsSync(file) && (await stat(file)).isDirectory()) file = join(file, 'index.html');
  else if (!existsSync(file)) {
    const asDir = join(dist, p, 'index.html');
    if (existsSync(asDir)) file = asDir;
  }
  return existsSync(file) ? file : null;
}

/** Serve one file with production-shaped compression. */
export async function sendFile(req, res, file) {
  const type = MIME[extname(file)] || 'application/octet-stream';
  let body = await readFile(file);
  const accept = String(req.headers['accept-encoding'] || '');
  if (COMPRESSIBLE.has(type)) {
    if (/\bbr\b/.test(accept)) {
      body = brotliCompressSync(body, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
      });
      res.setHeader('content-encoding', 'br');
    } else if (/\bgzip\b/.test(accept)) {
      body = gzipSync(body, { level: 6 });
      res.setHeader('content-encoding', 'gzip');
    }
    res.setHeader('vary', 'accept-encoding');
  }
  res.setHeader('content-type', type);
  res.setHeader('content-length', String(body.length));
  res.end(body);
}

/** Handle a request from `dist`. Returns false if the path matched no file,
 *  so a caller with its own routes (verify-results emulates /api/proxy) can
 *  fall through to this and keep its own responses byte-exact. */
export async function serveFromDist(dist, req, res) {
  const file = await resolveFile(dist, req.url || '/');
  if (!file) return false;
  await sendFile(req, res, file);
  return true;
}

/** A compressing static server on an ephemeral port. */
export function createStaticServer(dist, port = 0) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        if (!(await serveFromDist(dist, req, res))) {
          res.statusCode = 404;
          res.end('not found');
        }
      } catch {
        res.statusCode = 500;
        res.end('err');
      }
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// `npm run serve:dist [port]` — the harness for a Lighthouse run. Never use a
// plain static server for a measurement again; that is the whole point.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = join(process.cwd(), 'dist', 'client');
  if (!existsSync(dist)) {
    console.error('dist/client not found — run `astro build` first.');
    process.exit(1);
  }
  const port = Number(process.argv[2] || 8080);
  const server = await createStaticServer(dist, port);
  const { port: bound } = server.address();
  console.log(`serving dist/client with brotli/gzip on http://127.0.0.1:${bound}`);
  console.log('measurements taken against this server match production compression.');
}
