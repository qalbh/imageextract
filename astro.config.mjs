// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

import tailwindcss from '@tailwindcss/vite';

import react from '@astrojs/react';

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

  integrations: [react()]
});