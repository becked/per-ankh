// Ambient Node surfaces used only by unit tests that run on Vitest's Node pool
// (currently routes-doc.test.ts, which reads docs/api-reference.md from disk).
// The worker tsconfig ships @cloudflare/workers-types only — no @types/node —
// deliberately, so Node globals don't leak into worker source. These narrow
// declarations keep `tsc --noEmit` happy without that. This file has no
// imports/exports (script context), so `declare module` is an ambient
// declaration rather than an augmentation of a module that isn't there.

declare module "node:fs" {
	export function readFileSync(path: string | URL, encoding: "utf8"): string;
}

interface ImportMeta {
	readonly url: string;
}
