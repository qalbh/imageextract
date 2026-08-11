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
