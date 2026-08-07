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
) as { compatibility_date: string; compatibility_flags?: string[] };

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: wrangler.compatibility_date,
        compatibilityFlags: wrangler.compatibility_flags ?? [],
      },
    }),
  ],
});
