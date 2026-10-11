// Shared types for the UX-review capture bundle (`./per-ankh ux-review`).

// A viewport the whole walkthrough is replayed at. `id` is the filename
// suffix and the manifest key; `label` is what the viewer and README show.
export interface Breakpoint {
	id: string;
	label: string;
	width: number;
	height: number;
}

// The two auth passes. `anon` is the signed-out surface; `auth` runs the same
// browser with a session cookie.
export type Pass = "anon" | "auth";

// The identities one run captures against.
//   gameId            the public game whose detail tabs are walked
//   userId            the public profile captured anonymously (the game's
//                     owner)
//   authUserId        the user the signed-in pass is minted a session for
//   authLabel         that user's discord_username, for display only
//   screenshotGameId  the game the screenshots view is captured on — a second
//                     game, because the walked one is random and almost never
//                     has a screenshot. Null when no local game does, which
//                     drops that view from the bundle.
export interface ReviewIds {
	gameId: string;
	userId: string;
	authUserId: string;
	authLabel: string | null;
	screenshotGameId: string | null;
}

// One (pass × page × tab) capture at one breakpoint. Exactly one of `buf`,
// `error`, `note` is set: a JPEG, a failure reason, or verification text for
// the screens that are checked rather than shot.
export interface CaptureRecord {
	id: string;
	pass: Pass;
	page: string;
	tab: string | null;
	title: string;
	route: string;
	state: string;
	buf?: Buffer;
	error?: string;
	note?: string;
}

// A screen accumulates one CaptureRecord per breakpoint. `shots` maps a
// breakpoint id to the bundle-relative JPEG path, `errors` to the reason
// that breakpoint has none.
export interface Screen {
	id: string;
	pass: Pass;
	page: string;
	tab: string | null;
	title: string;
	route: string;
	state: string;
	shots: Record<string, string>;
	errors: Record<string, string>;
	note?: string;
}

// Bundle-level header, written into manifest.json and rendered into both the
// README and the viewer.
export interface ReviewMeta {
	generatedAt: string;
	baseUrl: string;
	ids: ReviewIds;
	breakpoints: Breakpoint[];
}
