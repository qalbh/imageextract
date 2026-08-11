// @ts-check
import { execSync } from 'node:child_process';
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

import tailwindcss from '@tailwindcss/vite';

import preact from '@astrojs/preact';

// /privacy's "Last updated" derives from git so it cannot rot silently:
// the date IS the file's last commit date, recomputed every build. This
// lives here (not in the page frontmatter) because the Cloudflare adapter
// prerenders in workerd, where node:child_process does not exist; the
// config runs in Node. Fallback is LOUD by request — a stale date on a
// privacy policy misleads.
let privacyLastUpdated = '';
try {
	privacyLastUpdated = execSync('git log -1 --format=%cs -- src/pages/privacy.astro', {
		encoding: 'utf8',
	}).trim();
} catch {
	// fall through to the warning below
}
if (privacyLastUpdated === '') {
	console.warn(
		'\n[privacy] WARNING: git date unavailable (untracked file or no git at build). ' +
			'"Last updated" on /privacy is falling back to a literal and may be STALE in a deploy.\n',
	);
	privacyLastUpdated = '2026-08-10';
}

// https://astro.build/config
export default defineConfig({
  // 'passthrough' because we never use Astro's image optimization; the
  // default ('cloudflare-binding') injects an IMAGES binding we don't want.
  adapter: cloudflare({ imageService: 'passthrough' }),

  // We never use sessions, but if no driver is set the adapter force-enables
  // its KV driver and injects a SESSION binding — which would provision a KV
  // namespace on deploy, violating this project's no-persistence rule. The
  // unstorage null driver is a no-op store: nothing is ever written.
  session: { driver: { entrypoint: 'unstorage/drivers/null' } },

  vite: {
    plugins: [tailwindcss()],
    define: {
      __PRIVACY_LAST_UPDATED__: JSON.stringify(privacyLastUpdated)
    }
  },

  // compat: true aliases react/react-dom to preact/compat through the
  // supported integration path, so we keep writing React-flavoured JSX while
  // shipping Preact's runtime. preact-render-to-string arrives as a proper
  // transitive dependency of the integration.
  integrations: [preact({ compat: true })]
});