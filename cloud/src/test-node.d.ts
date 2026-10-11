// Ambient Node surfaces used only by code that runs on Vitest's Node pool:
// the unit tests that read from disk (routes-doc.test.ts against
// docs/api-reference.md, and the two invariant guards that scan cloud/src/ for
// an inline literal), plus source-files.ts, the directory walk those two
// guards share.
// The worker tsconfig ships @cloudflare/workers-types only — no @types/node —
// deliberately, so Node globals don't leak into worker source. These narrow
// declarations keep `tsc --noEmit` happy without that. This file has no
// imports/exports (script context), so `declare module` is an ambient
// declaration rather than an augmentation of a module that isn't there.

declare module "node:fs" {
	export function readFileSync(path: string | URL, encoding: "utf8"): string;
	export function readdirSync(
		path: string | URL,
		options: { withFileTypes: true },
	): { name: string; isDirectory(): boolean }[];
}

interface ImportMeta {
	readonly url: string;
}
