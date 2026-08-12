import { readFileSync } from 'node:fs';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd, not Node, so URL parsing and fetch semantics are
// the ones production sees. wrangler.jsonc is the single source of truth for
// compatibility settings — parsed here by hand rather than via the plugin's
// `wrangler.configPath`, because that path also resolves `main` (the Astro
// server entry), which unit tests must not load and which the plugin
// misresolves with a warning on every run. Line comments are stripped before
// parsing; if the file ever gains block comments, this parse fails loudly at
// test startup rather than drifting silently.
const wrangler = JSON.parse(
  readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
) as {
  compatibility_date: string;
  compatibility_flags?: string[];
  observability?: { enabled?: boolean };
  limits?: { cpu_ms?: number; subrequests?: number };
  kv_namespaces?: Array<{ binding: string }>;
};

// The Tailwind Vite plugin claims every `.css` import, so `global.css?raw`
// resolves to an empty string inside the test bundle. The doc-sync test needs
// the file's verbatim @theme block, so read it here and inject it as a define.
const globalCss = readFileSync(new URL('./src/styles/global.css', import.meta.url), 'utf8');

// /privacy states "We use no analytics, advertising, or tracking services."
// Phase 6 plans Cloudflare Web Analytics — a different commit, weeks later,
// by someone not thinking about that page. Same class as the observability
// flag, which got a test after it bit: scan every shipped source for
// analytics markers here (Node side), and doc-sync layer 5 asserts the
// sentence and the markers cannot coexist. Scope: src pages, layouts,
// components, astro.config, package.json deps — every in-repo path an
// analytics tag can enter by. (The one uncoverable path is Cloudflare's
// DASHBOARD-side auto-injection, named in the layer 5 test as a residual.)
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const ANALYTICS_MARKERS = [
  'cloudflareinsights.com',
  'data-cf-beacon',
  'googletagmanager',
  'google-analytics.com',
  'gtag(',
  'plausible.io',
  'umami.',
  'usefathom',
  'posthog',
  'segment.com',
  'partytown',
];
function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(astro|ts|tsx|mjs|json)$/.test(name)) yield p;
  }
}
const shippedSources = [
  ...walk(new URL('./src', import.meta.url).pathname),
  new URL('./astro.config.mjs', import.meta.url).pathname,
  new URL('./package.json', import.meta.url).pathname,
];
const analyticsHits: string[] = [];
for (const file of shippedSources) {
  if (file.endsWith('vitest.config.ts') || file.includes('doc-sync')) continue;
  const text = readFileSync(file, 'utf8');
  for (const marker of ANALYTICS_MARKERS) {
    if (text.includes(marker)) analyticsHits.push(`${file.split('/src/').pop()}: ${marker}`);
  }
}
const privacySource = readFileSync(new URL('./src/pages/privacy.astro', import.meta.url), 'utf8');
const privacyGuard = {
  sentencePresent: privacySource.includes('We use no analytics, advertising, or tracking services.'),
  analyticsHits,
};

// Tool-variant landing pages (src/content/tools/*.md). Their frontmatter is
// the claim ledger: every capability sentence carries the code symbol or
// corpus row behind it, and `assumes` entries name symbols whose ARRIVAL makes
// copy stale. content-claims.test.ts checks both, so parse here (Node side,
// where a YAML parser and the filesystem exist) and inject the result — the
// same shape as __GLOBAL_CSS__ above.
//
// `yaml` (ISC, 2.9.0) is a devDependency for exactly this. Astro's own content
// layer parses these files at build time; this is the test's independent read
// of the same bytes, which is the point — a guard sharing its subject's parser
// inherits its blind spots.
import { parse as parseYaml } from 'yaml';
const toolsDir = new URL('./src/content/tools', import.meta.url).pathname;
const toolPages = readdirSync(toolsDir)
  .filter((name) => name.endsWith('.md'))
  .map((name) => {
    const raw = readFileSync(join(toolsDir, name), 'utf8');
    // Frontmatter is the block between the first two --- fences. A file that
    // does not open with one is a malformed page, and `data` stays null so the
    // test reports it rather than silently skipping it.
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    return {
      slug: name.replace(/\.md$/, ''),
      data: match ? (parseYaml(match[1] as string) as Record<string, unknown>) : null,
      body: match ? raw.slice(match[0].length) : raw,
    };
  });
// The landing page's rendered copy, for the no-verbatim-restatement rule: a
// tool page may not recycle a sentence that already exists on /.
const landingSource = readFileSync(new URL('./src/pages/index.astro', import.meta.url), 'utf8');

export default defineConfig({
  define: {
    __GLOBAL_CSS__: JSON.stringify(globalCss),
    __TOOL_PAGES__: JSON.stringify(toolPages),
    __LANDING_SOURCE__: JSON.stringify(landingSource),
    // The deployed config, injected so doc-sync can ASSERT it — the
    // observability constraint and the limits numbers are tested, not
    // remembered. A comment does not survive a file rewrite; a failing
    // suite does.
    __WRANGLER_CONFIG__: JSON.stringify(wrangler),
    __PRIVACY_GUARD__: JSON.stringify(privacyGuard),
  },
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: wrangler.compatibility_date,
        compatibilityFlags: wrangler.compatibility_flags ?? [],
        // A REAL (miniflare) KV binding for the blocklist, so route tests
        // exercise the production read path — `import { env } from
        // 'cloudflare:workers'` — instead of stubbing a locals shape. The
        // stub variant went green against Astro.locals.runtime.env, an API
        // the adapter had removed; only the dev-boot check caught it.
        kvNamespaces: ['BLOCKLIST'],
      },
    }),
  ],
});
