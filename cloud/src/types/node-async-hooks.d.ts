// Minimal ambient declaration for the slice of node:async_hooks we use
// (AsyncLocalStorage), gated at runtime by the nodejs_als compatibility
// flag in cloud/wrangler.toml. Kept in its own file so the `declare module`
// isn't treated as augmentation by TypeScript when imported alongside
// other top-level imports/exports.

declare module "node:async_hooks" {
	export class AsyncLocalStorage<T> {
		getStore(): T | undefined;
		run<R>(store: T, fn: () => R): R;
		enterWith(store: T): void;
		disable(): void;
		exit<R>(callback: () => R): R;
	}
}
