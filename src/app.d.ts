// SvelteKit ambient app declarations.
//
// `__BUILD_TARGET__` is injected as a static constant by Vite's `define`
// (see vite.config.js). The build pipeline rewrites references to a string
// literal at compile time, which means `if (__BUILD_TARGET__ === "cloud")`
// dead-code-eliminates correctly per target.
//
// No imports/exports — this file must remain a script (not a module) so
// the declarations are ambient/global.

declare const __BUILD_TARGET__: "tauri" | "cloud";

declare namespace App {
	// interface Error {}
	// interface Locals {}
	// interface PageData {}
	// interface PageState {}
	// interface Platform {}
}
