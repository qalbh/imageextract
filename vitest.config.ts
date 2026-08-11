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

export default defineConfig({
  define: {
    __GLOBAL_CSS__: JSON.stringify(globalCss),
    // The deployed config, injected so doc-sync can ASSERT it — the
    // observability constraint and the limits numbers are tested, not
    // remembered. A comment does not survive a file rewrite; a failing
    // suite does.
    __WRANGLER_CONFIG__: JSON.stringify(wrangler),
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
