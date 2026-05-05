// SSR is target-dependent.
//
//   tauri build → adapter-static SPA bundle. Tauri has no Node server, so
//                 SSR can't run; everything must be hydrated on the client.
//   cloud build → adapter-cloudflare with SSR. Public game pages need
//                 server-rendered <meta property="og:*"> tags so Discord/
//                 Slack/Twitter can unfurl shared URLs into preview cards.
//
// `__BUILD_TARGET__` is a static constant injected by Vite's `define` at
// build time, so the resulting `ssr` value is a literal `true` or `false`
// in the bundle (no runtime branch).
export const ssr = __BUILD_TARGET__ === "cloud";

// Prerendering is off for both targets — Tauri ships an SPA fallback,
// cloud serves dynamically.
export const prerender = false;

import { cloudApi, type UserMe } from "$lib/api-cloud";
import type { LayoutLoad } from "./$types";

// Layout-level user load. Provides `data.user` to the cloud header so it
// can render the avatar/display_name (or "Sign in") on every cloud page.
//
// Per-page auth guards stay where they are — those redirect on
// UnauthorizedError to /login. The layout fetch is for chrome only; a
// null `user` here just renders the signed-out header without disrupting
// the page's own load.
//
// Tauri target skips the call entirely — getMe() would hit the cloud
// API which doesn't apply to the desktop app.
export const load: LayoutLoad = async ({ fetch }): Promise<{ user: UserMe | null }> => {
	if (__BUILD_TARGET__ !== "cloud") return { user: null };
	try {
		const user = await cloudApi.getMe({ fetch });
		return { user };
	} catch {
		// Network errors etc. — header just renders signed-out state.
		// Page-level loads will surface real errors when they fire.
		return { user: null };
	}
};
