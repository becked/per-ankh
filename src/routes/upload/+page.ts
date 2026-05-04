// /upload uses Web Workers (parsing happens in a Worker pool) and gates on
// `cloudApi.getMe()` from `onMount`. Server-render attempts would 500 — no
// DOM, no Workers, no localhost-only auth. Force client-only.
export const ssr = false;
