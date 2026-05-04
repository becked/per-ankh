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
