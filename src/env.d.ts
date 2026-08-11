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

// Injected by astro.config.mjs at build: the legal pages' last-updated
// dates, derived from git so they cannot rot silently (the adapter
// prerenders in workerd, so the git calls must live in the Node-side
// config). Per-file: each date moves with its own page's copy.
declare const __PRIVACY_LAST_UPDATED__: string;
declare const __TERMS_LAST_UPDATED__: string;
