// Who should I play next?
//
// Picks ten opponents per player. The two things it optimises for turn out to
// be the same thing: a game both players might win is the one worth playing,
// and it is also the one that tells the rating model the most. That is not a
// coincidence — the information a Glicko-2 result carries about a player is
// g(phi_j)^2 * E * (1 - E), and E(1 - E) peaks at even odds. A 95% favourite
// learns nothing by winning, and nobody enjoys being the other 5%.
//
// Four things then shape that raw information into a recommendation:
//
//   - Uncertainty removed, not information gained. The same information about
//     an already-settled player is worth less, so the score converts to the
//     deviation each side would shed by playing. Large for someone the model
//     barely knows, near zero for a veteran — which is the right priority,
//     because the community learns most from the games of the people it knows
//     least about.
//   - Distance in the game graph. Per-pair information is blind to the case
//     where the community has split into groups that rarely play each other;
//     each group's ratings are then internally consistent and the offset
//     between them is guesswork. A game across that gap is worth more than the
//     local arithmetic says, so pairs who have never met, and share no
//     opponent, get a modest lift.
//   - Novelty and activity. The tenth rematch this month is neither fun nor
//     informative, and someone who stopped playing in March is not an
//     opponent.
//   - Load. The naive version — everyone's top ten computed independently —
//     piles up, because the best opponent for many people is the same person.
//     Lists are built in one pass with a running count of how often each
//     candidate has been picked, as a soft penalty and then a hard cap.
//
// Nothing numeric survives this file. What gets written down is a name, how
// many times the pair has already played, and badges the viewer could have
// worked out for themselves. See migration 0045.

import { g, expectedScore, SCALE, type Duel } from "./glicko2";
// Deliberately the tournament engine's RNG rather than a second one: it is a
// generic seeded mulberry32 that the pairing and map-assignment algorithms
// already use for exactly this reason — a shuffle a test can reproduce.
import { createRng, shuffle } from "../tournament/rng";
import { MAP_MEMORY_DAYS, pickMap } from "./pick-map";
import { canonicalMapScript } from "../tournament/canonical-maps";

// Ten. Enough that the list survives a few of them being busy, few enough to
// read in one go and to keep any single player from being everyone's answer.
export const RECOMMENDATION_COUNT = 10;

// ...and never fewer than six, whatever the model thinks.
//
// At the ends of the ladder there are genuinely only a handful of people who
// would give you a close game — the strongest player in the community had one
// name on their page — and a page with one name on it is not a recommendation,
// it is a dead end. Below this floor the no-stomp band is the last thing to
// give way, and it gives way in order of how close the game would still be.
export const MIN_RECOMMENDATION_COUNT = 6;

// A candidate must have been seen — logged in, or finished a rated game —
// within this many days. Wide, because Old World games take weeks: a player
// mid-match is invisible to both signals until the save lands.
const ACTIVE_WINDOW_DAYS = 90;

// Win probabilities outside this band are a stomp for somebody, and no amount
// of information redeems that game for the player on the wrong end.
const STOMP_WINDOW: readonly [number, number] = [0.3, 0.7];

// ...except that for a player the model barely knows, the estimate the band is
// applied to is itself a guess. Above this deviation the band widens rather
// than pretending to a precision it doesn't have, which is also what stops a
// newcomer's list from coming back empty.
const UNSETTLED_RD = 150;
const UNSETTLED_WINDOW: readonly [number, number] = [0.2, 0.8];

// How many of the ten may be players the model has barely placed.
//
// This is the one place where the arithmetic and a good evening's game pull
// apart, and the game wins. An unsettled player is worth suggesting — they need
// an opponent more than anyone, and their result teaches the model the most, so
// the uncertainty-shed score rates them highest. But every unrated player sits
// at the same starting rating, so "even odds" against one is not a prediction,
// it is the absence of one. Left to the score alone, a mid-ladder veteran's
// whole list comes back as ten strangers nobody can vouch for. Three of ten
// keeps newcomers visible on real players' lists without crowding out the
// pairings the model actually stands behind.
export const MAX_UNSETTLED_PER_LIST = 3;

// Rematch decay: how hard a recent meeting discounts the pair, and how far
// back "recent" reaches.
const NOVELTY_DECAY = 0.6;
const NOVELTY_WINDOW_DAYS = 90;

// Hard ceiling on how many lists one player may appear on, on top of the soft
// 1 / (1 + picked) penalty. Twice the list length: by the time a candidate has
// been chosen twenty times the soft penalty has already made them a last
// resort, and the cap is there so a thin pool cannot route the whole community
// to one person. Exported so the test pins the real ceiling rather than a copy
// of the number.
export const MAX_APPEARANCES = 2 * RECOMMENDATION_COUNT;

// Graph-distance multipliers. A pair that has already played is worth slightly
// less than a pair who share an opponent; a pair with no path between them at
// all is worth most, because that game is the only thing that would tie their
// two corners of the community together. A tilt, not a takeover.
const BRIDGE_WEIGHT: Record<number, number> = { 1: 0.85, 2: 1.0, 3: 1.15 };
const BRIDGE_WEIGHT_DISTANT = 1.3;
// The distance at which the pairing is worth calling out to the player, and
// how much of a circle the viewer needs before "we share nobody" is news about
// the pairing rather than news about them. Below the floor, everyone is far
// away by definition, and a badge on all ten rows says only "you are new" —
// ten times.
const BRIDGE_BADGE_DISTANCE = 3;
const BRIDGE_BADGE_MIN_CIRCLE = 3;

// A rated duel or two is not a track record, and saying so is the honest way
// to tell a viewer why a name they do not recognise is on their list.
const NEW_HERE_GAMES = 3;

const ACTIVE_THIS_WEEK_DAYS = 7;

// Every badge is a fact about the opponent or about the pair that the viewer
// could establish by reading a profile. None is derived from a rating.
export type OpponentBadge = "active_this_week" | "new_here" | "bridges_circles";

// One player the model knows something about. `lastActive` is the later of
// their most recent rated game and their most recent login, as YYYY-MM-DD.
export interface RecommendationCandidate {
	userId: string;
	r: number;
	rd: number;
	games: number;
	lastActive: string | null;
	openToMatches: boolean;
}

export interface Recommendation {
	opponentUserId: string;
	meetings: number;
	badges: OpponentBadge[];
	// A map from the atlas pool neither has played lately, by its atlas anchor.
	// Null when the pool is empty.
	mapAnchor: string | null;
}

// A duel, plus the map script it was played on where the record knows it. The
// rating engine takes plain Duels; the map suggestion needs this one field, and
// it is optional so a test can leave it out.
export interface RecommendationDuel extends Duel {
	script?: string | null;
}

// One shared empty map for players with no recent games, rather than a fresh
// allocation per candidate.
const EMPTY_PLAYS: ReadonlyMap<string, number> = new Map();

function daysBetween(from: string, to: string): number {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
	return (b - a) / 86_400_000;
}

// Recency weight on a candidate. Someone who played this week is the ideal
// suggestion; someone last seen two months ago is a long shot worth keeping in
// a thin pool but not worth leading with.
function activityWeight(daysSinceSeen: number): number {
	if (daysSinceSeen <= 14) return 1.0;
	if (daysSinceSeen <= 30) return 0.9;
	if (daysSinceSeen <= 60) return 0.8;
	return 0.7;
}

// The unordered pair key both directions of a duel agree on.
function pairKey(a: string, b: string): string {
	return a < b ? `${a} ${b}` : `${b} ${a}`;
}

// Breadth-first distance from one player to every other along the graph of who
// has played whom. Unreached players are absent from the map, which the caller
// reads as "no path at all" — the strongest bridging case there is.
function distancesFrom(
	origin: string,
	adjacency: Map<string, Set<string>>,
): Map<string, number> {
	const dist = new Map<string, number>([[origin, 0]]);
	let frontier = [origin];
	let depth = 0;
	while (frontier.length > 0) {
		depth += 1;
		const next: string[] = [];
		for (const node of frontier) {
			for (const neighbour of adjacency.get(node) ?? []) {
				if (dist.has(neighbour)) continue;
				dist.set(neighbour, depth);
				next.push(neighbour);
			}
		}
		frontier = next;
	}
	return dist;
}

/**
 * Build every player's list. Pure: the same players, duels and date always give
 * the same answer, which is what lets it be tested and what keeps a nightly
 * rebuild from reshuffling a list that has not changed.
 *
 * `today` is YYYY-MM-DD.
 */
export function buildRecommendations(args: {
	players: readonly RecommendationCandidate[];
	duels: readonly RecommendationDuel[];
	today: string;
}): Map<string, Recommendation[]> {
	const { players, duels, today } = args;

	const byId = new Map(players.map((p) => [p.userId, p]));

	// Who has played whom, how often, and how often lately.
	const adjacency = new Map<string, Set<string>>();
	const meetings = new Map<string, number>();
	const recentMeetings = new Map<string, number>();
	const scriptPlays = new Map<string, Map<string, number>>();
	for (const d of duels) {
		if (!byId.has(d.p1) || !byId.has(d.p2)) continue;
		for (const [a, b] of [
			[d.p1, d.p2],
			[d.p2, d.p1],
		]) {
			const set = adjacency.get(a);
			if (set) set.add(b);
			else adjacency.set(a, new Set([b]));
		}
		const key = pairKey(d.p1, d.p2);
		meetings.set(key, (meetings.get(key) ?? 0) + 1);
		const age = daysBetween(d.date, today);
		if (age <= NOVELTY_WINDOW_DAYS) {
			recentMeetings.set(key, (recentMeetings.get(key) ?? 0) + 1);
		}
		// What each of them has played on lately, for the map suggestion. Drawn
		// from the rated duels rather than every game either has uploaded: the
		// suggestion is for a game between these two, so their multiplayer
		// history is the relevant one, and it is the corpus already in hand.
		if (d.script && age <= MAP_MEMORY_DAYS) {
			for (const uid of [d.p1, d.p2]) {
				let byScript = scriptPlays.get(uid);
				if (!byScript) {
					byScript = new Map();
					scriptPlays.set(uid, byScript);
				}
				byScript.set(d.script, (byScript.get(d.script) ?? 0) + 1);
			}
		}
	}

	// Who may be suggested, and how strongly their recency argues for them.
	const eligible = new Map<string, number>();
	for (const p of players) {
		if (!p.openToMatches) continue;
		const idle = p.lastActive
			? daysBetween(p.lastActive, today)
			: Number.POSITIVE_INFINITY;
		if (idle > ACTIVE_WINDOW_DAYS) continue;
		eligible.set(p.userId, activityWeight(idle));
	}

	// Least-settled player first, so the people the model knows least get the
	// pick of the pool before the load penalty starts to bite. Ties by id, so
	// the pass is an ordering and not a coin flip.
	const receivers = [...players].sort(
		(a, b) => b.rd - a.rd || (a.userId < b.userId ? -1 : 1),
	);

	const picked = new Map<string, number>();
	const out = new Map<string, Recommendation[]>();

	for (const viewer of receivers) {
		const mu = (viewer.r - 1500) / SCALE;
		const phi = viewer.rd / SCALE;
		const [lo, hi] = viewer.rd > UNSETTLED_RD ? UNSETTLED_WINDOW : STOMP_WINDOW;
		const distance = distancesFrom(viewer.userId, adjacency);
		// You can only bridge two circles if you are in one.
		const viewerHasCircle =
			(adjacency.get(viewer.userId)?.size ?? 0) >= BRIDGE_BADGE_MIN_CIRCLE;

		const scored: {
			rec: Recommendation;
			score: number;
			inBand: boolean;
			unsettled: boolean;
			appearances: number;
		}[] = [];
		for (const [candidateId, recency] of eligible) {
			if (candidateId === viewer.userId) continue;
			const appearances = picked.get(candidateId) ?? 0;
			const candidate = byId.get(candidateId)!;

			const muJ = (candidate.r - 1500) / SCALE;
			const phiJ = candidate.rd / SCALE;
			const e = expectedScore(mu, muJ, phiJ);

			// The Fisher information each side would gain, converted to the
			// deviation they would shed by playing. The shared E(1 - E) is what
			// makes the even game the valuable one; the g(phi)^2 factors are why a
			// settled opponent is the sharper yardstick.
			const evenness = e * (1 - e);
			const shed = (ownPhi: number, information: number): number =>
				(ownPhi - 1 / Math.sqrt(1 / (ownPhi * ownPhi) + information)) * SCALE;
			const value =
				shed(phi, g(phiJ) * g(phiJ) * evenness) +
				shed(phiJ, g(phi) * g(phi) * evenness);

			const d = distance.get(candidateId);
			const bridge =
				d === undefined
					? BRIDGE_WEIGHT_DISTANT
					: (BRIDGE_WEIGHT[d] ?? BRIDGE_WEIGHT_DISTANT);
			const key = pairKey(viewer.userId, candidateId);
			const novelty = 1 / (1 + NOVELTY_DECAY * (recentMeetings.get(key) ?? 0));

			const score = (value * bridge * novelty * recency) / (1 + appearances);

			const badges: OpponentBadge[] = [];
			const idle = candidate.lastActive
				? daysBetween(candidate.lastActive, today)
				: Number.POSITIVE_INFINITY;
			if (idle <= ACTIVE_THIS_WEEK_DAYS) badges.push("active_this_week");
			if (candidate.games <= NEW_HERE_GAMES) badges.push("new_here");
			if (viewerHasCircle && (d === undefined || d >= BRIDGE_BADGE_DISTANCE)) {
				badges.push("bridges_circles");
			}

			scored.push({
				score,
				// Whether this is a game both of them might win. Recorded rather
				// than filtered on, because it is the last rule the fill below
				// relaxes and it has to still be there to relax.
				inBand: e >= lo && e <= hi,
				unsettled: candidate.rd > UNSETTLED_RD,
				appearances,
				rec: {
					opponentUserId: candidateId,
					meetings: meetings.get(key) ?? 0,
					badges,
					// Filled in below, once this list's ten are known.
					mapAnchor: null,
				},
			});
		}

		// Best score first, then down the list once per pass, each pass dropping
		// one rule — and a later pass only ever runs because an earlier one left
		// the list short.
		//
		// The first three rules exist to stop a healthy pool from piling everyone
		// onto a few names, and none of them is worth a short page. In this
		// community only a minority of players are settled enough to be a
		// confident pairing, so a strict reading hands exactly the veterans who
		// most want this feature a list of three, the appearance ceiling having
		// been spent on whoever was processed before them.
		//
		// The last pass gives up the no-stomp band itself, and only down to the
		// floor: at the ends of the ladder there really are only a handful of
		// close games available, and six names — the last of them not quite even
		// — beat one name and a lot of white space. Because the score's own
		// evenness term peaks at even odds, the order this pass admits people in
		// is closest-game-first.
		scored.sort((a, b) => b.score - a.score);
		const chosen: typeof scored = [];
		const taken = new Set<number>();
		let unsettledChosen = 0;
		const passes = [
			// Every rule honoured.
			{ target: RECOMMENDATION_COUNT, cap: true, quota: true, band: true },
			// Someone may be on one list too many.
			{ target: RECOMMENDATION_COUNT, cap: false, quota: true, band: true },
			// More than three of them may be players nobody can place yet.
			{ target: RECOMMENDATION_COUNT, cap: false, quota: false, band: true },
			// And finally, the game need not be even — but only to the floor.
			{
				target: MIN_RECOMMENDATION_COUNT,
				cap: false,
				quota: false,
				band: false,
			},
		];
		for (const pass of passes) {
			if (chosen.length >= pass.target) continue;
			for (const [index, candidate] of scored.entries()) {
				if (chosen.length >= pass.target) break;
				if (taken.has(index)) continue;
				if (pass.band && !candidate.inBand) continue;
				if (pass.cap && candidate.appearances >= MAX_APPEARANCES) continue;
				if (
					pass.quota &&
					candidate.unsettled &&
					unsettledChosen >= MAX_UNSETTLED_PER_LIST
				) {
					continue;
				}
				if (candidate.unsettled) unsettledChosen += 1;
				taken.add(index);
				chosen.push(candidate);
			}
		}
		for (const c of chosen) {
			picked.set(
				c.rec.opponentUserId,
				(picked.get(c.rec.opponentUserId) ?? 0) + 1,
			);
		}

		// Shuffled before it is stored, so the order the viewer reads carries no
		// information: the list is ten people, not a ranking of ten people. The
		// seed is the viewer and the day, so a reload does not reshuffle and a
		// test can reproduce it.
		const list = shuffle(
			chosen.map((c) => c.rec),
			createRng(`${viewer.userId}:${today}`),
		);

		// A map each, assigned only now that the ten are settled — an opponent
		// who didn't make the list shouldn't have used up a script. `used`
		// spreads the scripts across the page, which is worth more than the
		// symmetry it costs: two players comparing pages may find their matchup
		// listed under different maps, where a page of nine DOTAs is wrong in
		// front of everyone, every time. The per-pair seed still decides the
		// pick wherever the spread rule leaves a choice, so a reload doesn't
		// reroll anything.
		const used = new Set<string>();
		for (const rec of list) {
			const map = pickMap(
				scriptPlays.get(viewer.userId) ?? EMPTY_PLAYS,
				scriptPlays.get(rec.opponentUserId) ?? EMPTY_PLAYS,
				createRng(`map:${pairKey(viewer.userId, rec.opponentUserId)}:${today}`),
				used,
			);
			if (!map) continue;
			rec.mapAnchor = map.anchor;
			used.add(canonicalMapScript(map.script));
		}

		out.set(viewer.userId, list);
	}

	return out;
}
