// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

import tailwindcss from '@tailwindcss/vite';

import preact from '@astrojs/preact';

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
    plugins: [tailwindcss()]
  },

  // compat: true aliases react/react-dom to preact/compat through the
  // supported integration path, so we keep writing React-flavoured JSX while
  // shipping Preact's runtime. preact-render-to-string arrives as a proper
  // transitive dependency of the integration.
  integrations: [preact({ compat: true })]
});