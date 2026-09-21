// Who should I play next?
//
// Picks twelve opponents per player: the people the model is most confident
// would give them a close game. The score is closeness and nothing else —
// how far the predicted result sits from even odds — and the prediction is
// made from each side's conservative rating, r - 2·RD, the same estimate the
// community ladder ranks by. That is where uncertainty enters, and it enters
// against the pair: a player the model barely knows is placed at the bottom of
// what they might be, so they are only suggested to someone whose rating even
// that pessimistic estimate is close to. As their deviation collapses over a
// few games the estimate rises to meet their real rating and they move up
// the lists on their own.
//
// Three things then shape closeness into a recommendation:
//
//   - Novelty and activity. The tenth rematch this month is neither fun nor
//     informative, and someone who stopped playing in March is not an
//     opponent.
//   - Load. The naive version — everyone's top twelve computed independently —
//     piles up, because the best opponent for many people is the same person.
//     Lists are built in one pass with a running count of how often each
//     candidate has been picked, as a soft penalty and then a hard cap.
//   - A full page. At the ends of the ladder there are only a handful of
//     close games to be had, so the load cap and the closeness band are
//     preferences rather than gates: each gives way in turn rather than let
//     the page run short. What never gives way is who is in the pool at all —
//     an opt-out is an opt-out, and someone nobody has seen in months is not
//     an opponent however short the page would otherwise be.
//
// Nothing numeric survives this file. What gets written down is a name, how
// many times the pair has already played, and badges the viewer could have
// worked out for themselves. See migration 0046.

import { conservative, SCALE, winProbability, type Duel } from "./glicko2";

// Twelve. Enough that the list survives several of them being busy, few
// enough to read in one go and to keep any single player from being everyone's
// answer.
//
// It is a floor as much as a target: the load cap and the closeness band both
// give way before the page does, so nobody is handed the dead end the
// strongest player in the community used to get — one name and a lot of white
// space. Only the pool can make a list shorter than this, and it is the same
// pool for everybody, so a short page means the community had fewer than
// thirteen listed, active players that night.
export const RECOMMENDATION_COUNT = 12;

// A candidate must have been seen — logged in, or finished a rated game —
// within this many days. Wide, because Old World games take weeks: a player
// mid-match is invisible to both signals until the save lands.
const ACTIVE_WINDOW_DAYS = 90;

// Win probabilities outside this band are a stomp for somebody, and no amount
// of load-balancing redeems that game for the player on the wrong end.
const STOMP_WINDOW: readonly [number, number] = [0.3, 0.7];

// ...except that when either side is a player the model barely knows, the
// estimate the band is applied to is itself a guess. Above this deviation the
// band widens rather than pretending to a precision it doesn't have: do not
// promise a close game from a rating nobody trusts yet, but do not refuse one
// either.
const UNSETTLED_RD = 150;
const UNSETTLED_WINDOW: readonly [number, number] = [0.2, 0.8];

// Rematch decay: how hard a recent meeting discounts the pair, and how far
// back "recent" reaches.
const NOVELTY_DECAY = 0.6;
const NOVELTY_WINDOW_DAYS = 90;

// Hard ceiling on how many lists one player may appear on, on top of the soft
// 1 / (1 + picked) penalty. Twice the list length: by the time a candidate has
// been chosen two dozen times the soft penalty has already made them a last
// resort, and the cap is there so a thin pool cannot route the whole community
// to one person. Exported so the test pins the real ceiling rather than a copy
// of the number.
export const MAX_APPEARANCES = 2 * RECOMMENDATION_COUNT;

// A rated duel or two is not a track record, and saying so is the honest way
// to tell a viewer why a name they do not recognise is on their list. Counted
// over their public games, like every badge here.
const NEW_HERE_GAMES = 3;

const ACTIVE_THIS_WEEK_DAYS = 7;

// Every badge is a fact about the opponent that the viewer could establish by
// reading a profile. None is derived from a rating, and none from a game a
// visitor cannot see: both are counted over public results only, which is why
// the candidate carries a visible-record pair of fields beside the ones the
// pool is managed with.
export type OpponentBadge = "active_this_week" | "new_here";

// One player the model knows something about.
//
// `lastActive` is the later of their most recent rated game and their most
// recent login, as YYYY-MM-DD — the pool's own signal, deciding who is still
// around and in what order lists are built and stored. It is deliberately not
// what the badges read: a login appears on no profile, and neither does a
// private game. `publicGames` and `lastPublicPlayed` are the record a visitor
// can check, and the badges come from those.
export interface RecommendationCandidate {
	userId: string;
	r: number;
	rd: number;
	publicGames: number;
	lastPublicPlayed: string | null;
	lastActive: string | null;
	openToMatches: boolean;
}

export interface Recommendation {
	opponentUserId: string;
	meetings: number;
	badges: OpponentBadge[];
}

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

// Comparator: the later YYYY-MM-DD first. Dates in that shape sort as strings.
function byMostRecent(a: string, b: string): number {
	return a < b ? 1 : a > b ? -1 : 0;
}

/**
 * Build every player's list. Pure, and independent of the order the players
 * and duels arrive in — every sort here carries a tiebreak. That is what lets
 * it be tested, and what keeps a nightly rebuild from reordering a list that
 * has not changed.
 *
 * `today` is YYYY-MM-DD.
 */
export function buildRecommendations(args: {
	players: readonly RecommendationCandidate[];
	duels: readonly Duel[];
	today: string;
}): Map<string, Recommendation[]> {
	const { players, duels, today } = args;

	const byId = new Map(players.map((p) => [p.userId, p]));

	// How often each pair has played, and how often lately.
	const meetings = new Map<string, number>();
	const recentMeetings = new Map<string, number>();
	for (const d of duels) {
		if (!byId.has(d.p1) || !byId.has(d.p2)) continue;
		const key = pairKey(d.p1, d.p2);
		meetings.set(key, (meetings.get(key) ?? 0) + 1);
		if (daysBetween(d.date, today) <= NOVELTY_WINDOW_DAYS) {
			recentMeetings.set(key, (recentMeetings.get(key) ?? 0) + 1);
		}
	}

	// Who may be suggested, when they were last seen, and how strongly that
	// recency argues for them.
	const eligible = new Map<
		string,
		{ candidate: RecommendationCandidate; lastActive: string; recency: number }
	>();
	for (const p of players) {
		if (!p.openToMatches || p.lastActive === null) continue;
		const idle = daysBetween(p.lastActive, today);
		if (idle > ACTIVE_WINDOW_DAYS) continue;
		eligible.set(p.userId, {
			candidate: p,
			lastActive: p.lastActive,
			recency: activityWeight(idle),
		});
	}

	// Everyone gets a list, but the players who are themselves in the pool get
	// theirs first, most recently seen first within it. Someone hidden or idle
	// still spends the load budget of the names on their page, and they are
	// the least likely to act on it, so they take what is left rather than
	// what the active players wanted; among the active, the person who played
	// this week is the likeliest to read the page. Ties by id, so the pass is
	// an ordering and not a coin flip.
	const receivers = [...players].sort(
		(a, b) =>
			Number(eligible.has(b.userId)) - Number(eligible.has(a.userId)) ||
			byMostRecent(a.lastActive ?? "", b.lastActive ?? "") ||
			(a.userId < b.userId ? -1 : 1),
	);

	const picked = new Map<string, number>();
	const out = new Map<string, Recommendation[]>();

	for (const viewer of receivers) {
		const mu = (conservative(viewer.r, viewer.rd) - 1500) / SCALE;

		const scored: {
			rec: Recommendation;
			score: number;
			inBand: boolean;
			lastActive: string;
			appearances: number;
		}[] = [];
		for (const [candidateId, { candidate, lastActive, recency }] of eligible) {
			if (candidateId === viewer.userId) continue;
			const appearances = picked.get(candidateId) ?? 0;

			// The predicted result between the two conservative ratings — see
			// winProbability for why the gap is taken at face value.
			const muJ = (conservative(candidate.r, candidate.rd) - 1500) / SCALE;
			const e = winProbability(mu, muJ);

			// Closeness: even odds score 0.5, a certainty scores 0. One
			// expression, and it says the thing the tab promises.
			const closeness = 0.5 - Math.abs(e - 0.5);

			const key = pairKey(viewer.userId, candidateId);
			const novelty = 1 / (1 + NOVELTY_DECAY * (recentMeetings.get(key) ?? 0));

			const score = (closeness * novelty * recency) / (1 + appearances);

			const badges: OpponentBadge[] = [];
			const sinceVisible = candidate.lastPublicPlayed
				? daysBetween(candidate.lastPublicPlayed, today)
				: Number.POSITIVE_INFINITY;
			if (sinceVisible <= ACTIVE_THIS_WEEK_DAYS) {
				badges.push("active_this_week");
			}
			if (candidate.publicGames <= NEW_HERE_GAMES) badges.push("new_here");

			const [lo, hi] =
				viewer.rd > UNSETTLED_RD || candidate.rd > UNSETTLED_RD
					? UNSETTLED_WINDOW
					: STOMP_WINDOW;
			scored.push({
				score,
				// Whether this is a game both of them might win. Recorded rather
				// than filtered on, because it is the last rule the fill below
				// relaxes and it has to still be there to relax.
				inBand: e >= lo && e <= hi,
				lastActive,
				appearances,
				rec: {
					opponentUserId: candidateId,
					meetings: meetings.get(key) ?? 0,
					badges,
				},
			});
		}

		// Best score first, then down the list once per pass, each pass dropping
		// one rule — and a later pass only ever runs because an earlier one left
		// the list short.
		//
		// The appearance ceiling exists to stop a healthy pool from piling
		// everyone onto a few names, and it is not worth a short page: in this
		// community only a minority of players are settled enough to be a
		// confident pairing, so a strict reading hands exactly the veterans who
		// most want this feature a list of three, the ceiling having been spent
		// on whoever was processed before them.
		//
		// The last pass gives up the no-stomp band itself. Since the page is
		// twelve names or the pool, whichever is smaller, the band decides who
		// is on a list rather than how long it is: it only keeps anyone off a
		// page that twelve close games can fill. At the ends of the ladder
		// there are not twelve, and the honest reading of the last names there
		// is not "close" but "the closest there are" — which still beats the
		// one-name page this replaced. The score is closeness discounted by
		// rematches, staleness and load, so the order this pass admits people
		// in is closest-game-first with those three having had their say.
		//
		// Descending score, ties by id. The tiebreak is what makes the purity
		// above true of a rebuild and not only of a call: two candidates can
		// score exactly equal, and without it their order would be the order they
		// were pushed in — which is the order D1 returned the duel rows in, and
		// nothing pins that.
		scored.sort(
			(a, b) =>
				b.score - a.score ||
				(a.rec.opponentUserId < b.rec.opponentUserId ? -1 : 1),
		);
		const chosen: typeof scored = [];
		const taken = new Set<number>();
		const passes = [
			// Every rule honoured.
			{ cap: true, band: true },
			// Someone may be on one list too many.
			{ cap: false, band: true },
			// And finally, the game need not be even.
			{ cap: false, band: false },
		];
		for (const pass of passes) {
			if (chosen.length >= RECOMMENDATION_COUNT) break;
			for (const [index, candidate] of scored.entries()) {
				if (chosen.length >= RECOMMENDATION_COUNT) break;
				if (taken.has(index)) continue;
				if (pass.band && !candidate.inBand) continue;
				if (pass.cap && candidate.appearances >= MAX_APPEARANCES) continue;
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

		// Stored most recently active first. The order the viewer reads must
		// carry nothing about rating — sorted by score, the first name would be
		// their nearest neighbour on the ladder — and last-active is both safe
		// and the next thing they want to know: who can actually play this
		// week. Ties by id, so the list is stable between rebuilds.
		chosen.sort(
			(a, b) =>
				byMostRecent(a.lastActive, b.lastActive) ||
				(a.rec.opponentUserId < b.rec.opponentUserId ? -1 : 1),
		);
		out.set(
			viewer.userId,
			chosen.map((c) => c.rec),
		);
	}

	return out;
}
