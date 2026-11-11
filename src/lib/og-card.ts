// The link-preview card's renderer version — the second segment of that card's
// cache key, beside the game's `updated_at`.
//
// `GET /v1/games/:id/card.png` is served `immutable` for a year
// (cloud/src/og-card/handler.ts), and a Worker deploy does not purge stored
// edge entries. `updated_at` moves when the *game* changes; nothing moves when
// the *renderer* changes, so without this a card drawn by an older
// cloud/src/og-card/card-svg.ts keeps being served for up to a year. Bump it
// whenever that file changes what a card looks like. Nothing in circulation
// breaks: the handler answers a superseded URL with a redirect to the current
// one, and Discord's own CDN holds the picture it already unfurled either way.
//
// It lives in src/lib/ rather than beside the renderer because both packages
// have to agree on it and only this direction is importable — cloud/ already
// imports src/lib/* modules (card-svg.ts does), while the browser bundle
// cannot reach a Worker module. That is the same constraint CARD_WIDTH /
// GAME_CARD_WIDTH are duplicated under, resolved the other way round because
// a version that has to be bumped in two places is a version that will not be.
export const OG_CARD_VERSION = 1;
