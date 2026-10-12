// /upload uses Web Workers (parsing happens in a Worker pool) and gates on
// `cloudApi.getMe()` from `onMount`. Server-render attempts would 500 — no
// DOM, no Workers, no localhost-only auth. Force client-only.
export const ssr = false;

import { cloudApi } from "$lib/api-cloud";
import type { ChallengeRules } from "$lib/challenges/types";
import { safeNext } from "$lib/utils/safe-next";
import type { PageLoad } from "./$types";

// The page has three modes, chosen by the query string: a plain upload, a
// tournament match save (?tournament_match_id&return_slug), and a challenge
// run (?challenge_id&return_number). Each names itself differently and hangs
// off a different parent.
export type UploadMode = "plain" | "tournament" | "challenge";

// Each mode names itself in three places — the tab title, the page heading,
// and the trail's leaf — so the word is chosen once, here.
const MODE_COPY: Record<UploadMode, { heading: string; description: string }> =
	{
		plain: {
			heading: "Upload",
			description: "Upload an Old World save file to Per-Ankh.",
		},
		tournament: {
			heading: "Upload save",
			description: "Upload a match save to a Per-Ankh tournament.",
		},
		challenge: {
			heading: "Submit run",
			description: "Submit a run to a Per-Ankh challenge map.",
		},
	};

// Context resolution lives in the load rather than in `onMount` so the title
// and the breadcrumb are right on the first paint — resolved later they flip
// under the reader once the fetch lands.
export const load: PageLoad = async ({ url, fetch }) => {
	// Optional tournament-match link. When the upload page is reached via
	// /upload?tournament_match_id=X&return_slug=Y, the upload is forwarded
	// to the worker with the link field, which auto-publics the game and
	// drops it into the user's "Tournament: {name}" collection. ?observer=1
	// switches the modal into observer mode (admin uploading on behalf).
	const tournamentMatchId = url.searchParams.get("tournament_match_id");
	const returnSlug = url.searchParams.get("return_slug");
	// Optional challenge-run link (/upload?challenge_id=X&return_number=N):
	// the upload is scored against the challenge and lands on its leaderboard.
	const challengeId = url.searchParams.get("challenge_id");
	const returnNumber = Number(url.searchParams.get("return_number")) || null;
	// A challenge run is always played from the map's own seat, so observer
	// mode is meaningless there — the flag is ignored rather than honoured.
	const observerMode =
		challengeId === null && url.searchParams.get("observer") === "1";
	// The page the upload was launched from (set by the header Upload link).
	// Sanitized to a same-origin path so Done returns the user where they came
	// from rather than always to their profile. Null when absent.
	const fromPath = url.searchParams.has("from")
		? safeNext(url.searchParams.get("from"))
		: null;

	const mode: UploadMode = challengeId
		? "challenge"
		: tournamentMatchId && returnSlug
			? "tournament"
			: "plain";

	// Challenge mode needs the rules up front — without them the modal can't
	// score the save, so this one is a hard requirement; the title carries the
	// trail's middle crumb.
	let challenge: {
		challenge_id: string;
		number: number;
		title: string;
		rules: ChallengeRules;
	} | null = null;
	let challengeError: string | null = null;
	if (challengeId && !returnNumber) {
		challengeError = "Challenge link is incomplete.";
	} else if (challengeId && returnNumber) {
		try {
			const { challenge: detail } = await cloudApi.getChallenge(returnNumber, {
				fetch,
			});
			if (detail.challenge_id !== challengeId) {
				challengeError = "Challenge link doesn't match.";
			} else {
				challenge = {
					challenge_id: detail.challenge_id,
					number: detail.number,
					title: detail.title,
					rules: {
						setup: detail.setup,
						objectives: detail.objectives,
						criteria: detail.criteria,
					},
				};
			}
		} catch (err) {
			challengeError =
				err instanceof Error ? err.message : "Failed to load challenge";
		}
	}

	// The tournament's name is the trail's middle crumb; in observer mode the
	// match + standings also label the mapping picker ("Slot A (becked) played
	// as: …"). Neither is load-bearing for the upload itself — the return path
	// comes from the slug in the URL and the worker validates the mapping — so
	// a failure here degrades the trail to a generic label and the picker to
	// "Slot A / Slot B" rather than blocking the page.
	let tournamentName: string | null = null;
	let slotALabel: string | null = null;
	let slotBLabel: string | null = null;
	let tournamentError: string | null = null;
	if (tournamentMatchId && returnSlug) {
		// All three start together — the match and standings reads take the slug,
		// so neither waits on the detail response for an id (issue #292). The
		// detail is still awaited *first*, which is what keeps the degradation
		// steps distinct: a trail that lost only the picker labels still says
		// which tournament it belongs to, where awaiting all three as a group
		// would drop the name over a failure in either of the other two.
		//
		// The no-op .catch keeps an abandoned rejection — observerMode's pair
		// when getTournament throws — from surfacing as an unhandled rejection.
		// It handles a *derived* promise, so awaiting the originals below still
		// propagates their failures into the catch block. Same idiom as
		// src/routes/users/[user_id]/+page.ts.
		//
		// What starting them together costs is on the 404 path, the same cost
		// home and tournaments/[slug]/+layout.ts record: in observer mode a dead
		// or setup-hidden returnSlug now spends three `tournament_view` slots
		// instead of one, because the match and standings reads are in flight
		// before the detail's 404 lands. Accepted on the same terms — a
		// reachable page spent three already, and the ceiling is 2400/hr per IP.
		const tournamentP = cloudApi.getTournament(returnSlug, { fetch });
		const matchP = observerMode
			? cloudApi.getTournamentMatch(returnSlug, tournamentMatchId, { fetch })
			: null;
		const standingsP = observerMode
			? cloudApi.getTournamentStandings(returnSlug, { fetch })
			: null;
		matchP?.catch(() => {});
		standingsP?.catch(() => {});
		try {
			const tournament = await tournamentP;
			tournamentName = tournament.name;
			if (matchP && standingsP) {
				const [match, standings] = await Promise.all([matchP, standingsP]);
				const labelById: Record<string, string> = {};
				for (const div of ["A", "B"] as const) {
					for (const s of standings.divisions[div].standings) {
						if (s.display_name) labelById[s.slot_id] = s.display_name;
					}
				}
				slotALabel = labelById[match.slot_a_id] ?? "Slot A";
				slotBLabel = match.slot_b_id
					? (labelById[match.slot_b_id] ?? "Slot B")
					: "BYE";
			}
		} catch (err) {
			tournamentError =
				err instanceof Error ? err.message : "Failed to load match info";
		}
	}

	const { heading, description } = MODE_COPY[mode];
	return {
		mode,
		heading,
		tournamentMatchId,
		returnSlug,
		tournamentName,
		observerMode,
		slotALabel,
		slotBLabel,
		tournamentError,
		challenge,
		challengeNumber: returnNumber,
		challengeError,
		fromPath,
		meta: { title: `${heading} - Per-Ankh`, description },
	};
};
