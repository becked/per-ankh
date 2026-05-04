// /auth/callback reads `code` and `state` from window.location.search and
// posts them to the API from `onMount`. There's no server-side equivalent
// to "extract the OAuth code and exchange it" that needs SSR — keep it
// client-only.
export const ssr = false;
