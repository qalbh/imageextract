// @ts-check
import { execSync } from 'node:child_process';
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

import tailwindcss from '@tailwindcss/vite';

import preact from '@astrojs/preact';

// Legal pages' "Last updated" derives from git so it cannot rot silently:
// each date IS its file's last commit date, recomputed every build. This
// lives here (not in page frontmatter) because the Cloudflare adapter
// prerenders in workerd, where node:child_process does not exist; the
// config runs in Node. Fallback is LOUD by request — a stale date on a
// legal page misleads. Per-file on purpose: each page's date moves with
// its OWN copy, which is what "the date below changes with it" promises.
/** @param {string} path */
function gitDateOf(path) {
	let date = '';
	try {
		date = execSync(`git log -1 --format=%cs -- ${path}`, { encoding: 'utf8' }).trim();
	} catch {
		// fall through to the warning below
	}
	if (date === '') {
		console.warn(
			`\n[legal-dates] WARNING: git date unavailable for ${path} (untracked file or no git ` +
				'at build). "Last updated" is falling back to a literal and may be STALE in a deploy.\n',
		);
		date = '2026-08-10';
	}
	return date;
}
const privacyLastUpdated = gitDateOf('src/pages/privacy.astro');
const termsLastUpdated = gitDateOf('src/pages/terms.astro');

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
      __PRIVACY_LAST_UPDATED__: JSON.stringify(privacyLastUpdated),
      __TERMS_LAST_UPDATED__: JSON.stringify(termsLastUpdated)
    }
  },

  // compat: true aliases react/react-dom to preact/compat through the
  // supported integration path, so we keep writing React-flavoured JSX while
  // shipping Preact's runtime. preact-render-to-string arrives as a proper
  // transitive dependency of the integration.
  integrations: [preact({ compat: true })]
});