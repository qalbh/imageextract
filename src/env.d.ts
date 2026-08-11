/// <reference types="vite/client" />

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
	interface Locals extends Runtime {}
}

// The vitest workers pool provides this module at runtime; the package's
// types aren't wired into tsconfig, so declare the one export we use.
declare module "cloudflare:test" {
	export const env: Record<string, unknown>;
}

// Injected by astro.config.mjs at build: /privacy's last-updated date,
// derived from git so it cannot rot silently (the adapter prerenders in
// workerd, so the git call must live in the Node-side config).
declare const __PRIVACY_LAST_UPDATED__: string;
