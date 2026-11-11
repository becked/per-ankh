// The two facts about the link-preview card that both packages have to agree
// on: its renderer version and its pixel size. The Worker renders the card
// (cloud/src/og-card/) and the game page declares it to crawlers, so each of
// these is read from here by both.
//
// ── Renderer version ──
//
// The second segment of the card's cache key, beside the game's `updated_at`.
//
// `GET /v1/games/:id/card.png` is stored for a day at the edge and a year in
// the browser (cloud/src/og-card/handler.ts), and a Worker deploy purges
// neither. `updated_at` moves when the *game* changes; nothing moves when the
// *renderer* changes, so without this a card drawn by an older
// cloud/src/og-card/card-svg.ts keeps being served — for a day to everyone,
// and for a year to whoever already has it. Bump it whenever that file changes
// what a card looks like. Nothing in circulation breaks: the handler answers a
// superseded URL with a redirect to the current one, and Discord's own CDN
// holds the picture it already unfurled either way.
//
// It lives in src/lib/ rather than beside the renderer because both packages
// have to agree on it and only this direction is importable — cloud/ already
// imports src/lib/* modules (card-svg.ts does), while the browser bundle
// cannot reach a Worker module.
export const OG_CARD_VERSION = 1;

// ── Pixel size ──
//
// What card-svg.ts draws on, and what the game page declares to crawlers as
// og:image:width / og:image:height. Fixed for every game — the Worker renders
// one canvas size, and a game with nothing to chart centres its rows inside it
// rather than coming out shorter, which is what lets one declared pair be true
// of every game.
//
// Here rather than beside the renderer for the same reason OG_CARD_VERSION
// is: the two packages have to agree and only this direction is importable.
// One definition rather than two that say "change both" — a disagreement
// shows as an embed whose image slot is the wrong shape, which the crawler
// lays out before the bytes land and does not re-measure after.
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
