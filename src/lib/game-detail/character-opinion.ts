// What a unit's general thinks of their own leader, recomputed.
//
// Old World stores no opinion value in a save. `Character.writeGameXML`
// (Character.cs:832) never writes `maiOpinionRate` — 0 `<Opinion>`,
// `<OpinionRate>` or `<JobOpinionRate>` elements across the 16 saves in
// test-data/saves — because the game rebuilds every character's rate on load:
// `Game.createFromXML` reads the document inside a `GameInitializingScope`
// (which is why `Character.updateOpinion`, Character.cs:5465, early-returns
// during the read), then calls `postStart()` (Game.cs:1938), whose
// `updateCharacterOpinionAll()` (`:12152`) fans out over every character ×
// every player. So the rate is a pure function of loaded save state, and this
// module is that function.
//
// What reads it: a unit's strength. `Unit.baseStrengthModifier`
// (Unit.cs:6334) adds `player().characterOpinionOfUs(pGeneral)
// .miStrengthModifier` for any unit that has a general — −20% when the general
// is furious with their leader, +10% when friendly.
//
// `Player.calculateCharacterOpinionRate` (PlayerOpinion.cs:1059) sums 27
// terms through `opinionCombine` (`:8`), which is plain addition over a
// nullable accumulator, so the sum is order-independent and a term that
// returns null contributes nothing. Of the 27:
//
//   * ELEVEN are identically zero here. `ReligionTraits`, `ProximityTraits`,
//     `StrengthTraits`, `KnowledgeTraits`, `GeneralsTraits`, `ExplorersTraits`,
//     `GovernorsTraits`, `WondersTraits`, `LawsTraits`, `CognomenTraits` and
//     `TradesTraits` each delegate to a per-trait method that returns 0 when
//     `pCharacter.getTeam() == getTeam()`, before testing anything else
//     (`calculateCharacterOpinionProximityTrait`, PlayerOpinion.cs:563, and
//     its ten siblings between `:500` and `:1057`). They model what a RIVAL
//     leader thinks, and a character asked about their own leader is never on
//     the other team.
//   * `EffectPlayer` (`:15`) cannot fire either. Its first branch needs
//     `pCharacter.isLeader()` — which the rate's own `pCharacter == leader()`
//     guard has already excluded — or `isTribeLeader()`, which a player's own
//     courtier is not; its leader-descendant branch reads
//     `miLeaderDescendantOpinionChange`, which no named entry of
//     effectPlayer.xml sets at all (0 of 282); and its remaining branch needs
//     `game().originalAllHumanTeams()`, which turns on `isPlayerHumanOriginal`
//     and is not on the blob.
//   * `Ethnicity` (`:385`) is the one term the blob genuinely cannot answer —
//     see ETHNICITY below.
//
// That leaves the fourteen computed here. Every one is checked against the XML
// it reads via the baked tables in `$lib/generated/character-opinion`.

import {
	COUNCIL_JOBS,
	COUNCIL_OPINION,
	GENERAL_JOB,
	JOB_OPINION,
	JOB_OPINION_RATE_TRAITS,
	MEMORY_OPINION,
	NO_SUCCESSION_TRAITS,
	OPINION_CHARACTER_BANDS,
	OPINION_GLOBALS,
	RELATIONSHIP_OPINION,
	RELIGION_WORLD_CLASS,
	SUCCESSION_GENDERS,
	SUCCESSION_RETURN_TRAITS,
	TRAIT_OPINION,
	type OpinionCharacterBand,
} from "$lib/generated/character-opinion";
import type { CharacterInfo, FullGameData } from "$lib/parser/types";

/** The blob fields the sum reads. */
export type OpinionGame = Pick<
	FullGameData,
	| "game_details"
	| "characters"
	| "character_traits"
	| "character_relationships"
	| "character_marriages"
	| "current_laws"
	| "memory_data"
	| "player_councils"
	| "game_religions"
	| "units"
>;

/** A character's standing with their leader, and what it does to a led unit. */
export interface CharacterOpinion {
	/**
	 * The summed rate. A null sum reads as 0, the way `updateOpinion`
	 * (Character.cs:5465) stores `calculateCharacterOpinionRate(this) ?? 0`.
	 */
	rate: number;
	/** The band the rate falls in — an OPINIONCHARACTER_* zType. */
	band: string;
	/** Percent the band adds to the strength of a unit this character leads. */
	strengthModifier: number;
	/**
	 * Whether a term the blob could not answer is big enough to put the rate in
	 * a DIFFERENT band — i.e. whether `band` and `strengthModifier` could be
	 * wrong, not merely whether `rate` could be. An unanswered term is common
	 * and usually harmless: the bands are 100 wide, each unanswered term is
	 * worth 20 or 40, and a general sitting mid-band is unaffected by all of
	 * them.
	 *
	 * Two things leave a term unanswered. A blob parsed before PARSER_VERSION
	 * 2.24.0 carries none of the heir / council / social-parent /
	 * religion-head inputs. And a player whose heir follows succession law
	 * rather than a nomination leaves the Heir term open whatever the blob's
	 * vintage, because this module stops at `<ChosenHeirID>` rather than
	 * re-deriving five succession walks for a term worth 20 (see `heirTerm`).
	 */
	uncertain: boolean;
}

/**
 * The band a rate falls in. Bands are ascending, and `getOpinionFromRate`
 * (InfoHelpers.cs:2302) takes the one with the smallest threshold still at or
 * above the rate — so the first band the rate doesn't exceed wins, and a rate
 * above every threshold gets the open-ended last one.
 */
function opinionBand(rate: number): OpinionCharacterBand {
	for (const band of OPINION_CHARACTER_BANDS) {
		if (band.threshold == null || rate <= band.threshold) return band;
	}
	return OPINION_CHARACTER_BANDS[OPINION_CHARACTER_BANDS.length - 1];
}

/**
 * What the general `generalXmlId` thinks of the leader of `playerXmlId`, as
 * the game would have recomputed it at the save's final turn. Null when the
 * blob can't place the pair: no such character or player, a character who
 * isn't that player's own, or one who leads none of that player's units.
 *
 * Both of those last two restrictions are load-bearing rather than
 * convenient. Own-player: the eleven terms this module treats as identically
 * zero are zero only because `pCharacter.getTeam() == getTeam()`, so a
 * foreign character would need all eleven and a partial sum would be a wrong
 * number rather than a missing one. Leads-a-unit: it is what makes the Job
 * term exact, since `Character.getJob` (Character.cs:9364) tests GENERAL_JOB
 * before everything else, while a courtier who leads nothing could be an
 * explorer or an agent — neither of which the save's parsed shape can rule
 * out. On a blob from before PARSER_VERSION 2.23.0 no unit names its general
 * at all, so there is nobody to ask about and null is the whole answer.
 *
 * Three of the rate's four guards are applied exactly: a missing character
 * (null here), a dead character, and the character being the leader
 * themselves — both of the last two give a null rate, which is 0, which is
 * Cautious, which is no strength modifier at all. The fourth, `isDead()` on
 * the PLAYER, is not: `<Dead/>` on a Player node isn't parsed, and a dead
 * player holds no units, so it cannot fire for a unit's general (0 of the
 * corpus's 203 generals belong to one of its 3 dead players).
 */
export function generalOpinionOfLeader(
	game: OpinionGame,
	generalXmlId: number,
	playerXmlId: number,
): CharacterOpinion | null {
	const characterXmlId = generalXmlId;
	const character = game.characters.find((c) => c.xml_id === characterXmlId);
	const player = game.game_details.players.find(
		(p) => p.player_id === playerXmlId,
	);
	if (character == null || player == null) return null;
	if (character.player_xml_id !== playerXmlId) return null;
	if (
		!game.units.some(
			(u) =>
				u.general_xml_id === characterXmlId && u.player_xml_id === playerXmlId,
		)
	) {
		return null;
	}

	const leaderId = player.leader_character_xml_id ?? null;
	const leader =
		leaderId != null
			? (game.characters.find((c) => c.xml_id === leaderId) ?? null)
			: null;

	// `pCharacter.isDead()` and `pCharacter == leader()` each return a null
	// rate, which `updateOpinion` stores as 0.
	if (character.death_turn != null || characterXmlId === leaderId) {
		return settle(0, 0, 0);
	}

	const traits = traitsOf(game, characterXmlId);
	const leaderTraits = leader != null ? traitsOf(game, leader.xml_id) : [];
	const isReligionHead = game.game_religions.some(
		(r) => r.head_character_xml_id === characterXmlId,
	);
	// A blob from before 2.24.0 carries no religion head at all, which is a
	// different claim from "heads no religion" — and the head doubles both
	// religion terms below.
	const headKnown = game.game_religions.every(
		(r) => r.head_character_xml_id !== undefined,
	);

	let rate = 0;
	// How far an unanswered term could move `rate`, below and above. Both stay 0
	// when the blob answers everything, which is what makes `uncertain` mean
	// "the band could be wrong" rather than "something was missing".
	let slackLow = 0;
	let slackHigh = 0;

	// ── Memory (`:73`) ──────────────────────────────────────────────────────
	// The player's own memory list, filtered to this character. `memory_data`
	// comes from the Player node's live memory list, which is what
	// `getMemoryList()` iterates — and `doMemoryTurn` (Player.cs:14581) drops
	// a memory once `getTurn() >= miTurn + iTurns`, so nothing in the list has
	// outlived its window.
	const now = game.game_details.total_turns;
	for (const memory of game.memory_data) {
		if (memory.player_xml_id !== playerXmlId) continue;
		if (memory.target_character_xml_id !== characterXmlId) continue;
		const info = MEMORY_OPINION[memory.memory_type];
		if (info == null) continue;
		rate += adjustedMemoryValue(info.value, info.turns, memory.turn, now);
	}

	// ── Relationship (`:96`) ────────────────────────────────────────────────
	// The character's own relationship list naming the leader. `ended_turn` on
	// these rows is hardcoded null (`parseCharacterRelationships`), so it is
	// not a filter — and it needn't be: `<RelationshipList>` is the live list
	// `getRelationshipList()` returns, so a relationship that ended is not in
	// it.
	if (leaderId != null) {
		for (const rel of game.character_relationships) {
			if (rel.character_xml_id !== characterXmlId) continue;
			if (rel.related_character_xml_id !== leaderId) continue;
			rate += RELATIONSHIP_OPINION[rel.relationship_type] ?? 0;
		}
	}

	// ── Trait (`:121`) / TraitSame (`:141`) / TraitDiff (`:166`) ────────────
	// `<TraitTurn>` is the live trait set `getTraits()` walks (its
	// `removed_turn` is hardcoded null for the same reason as above).
	for (const trait of traits) {
		const row = TRAIT_OPINION[trait];
		if (row == null) continue;
		rate += row.opinion ?? 0;
		if (row.opinionSame != null && leaderTraits.includes(trait)) {
			rate += row.opinionSame;
		}
		if (row.traitOpinion != null) {
			for (const leaderTrait of leaderTraits) {
				rate += row.traitOpinion[leaderTrait] ?? 0;
			}
		}
	}

	// ── TraitLaw (`:194`) ───────────────────────────────────────────────────
	// `current_laws` drops succession laws (LAWCLASS_ORDER) as realm defaults
	// rather than civic adoptions, which costs this term nothing: all 11 laws
	// that any trait's `aiLawOpinion` names belong to ordinary law classes.
	const activeLaws = game.current_laws
		.filter((l) => l.player_id === playerXmlId)
		.map((l) => l.law);
	for (const trait of traits) {
		const lawOpinion = TRAIT_OPINION[trait]?.lawOpinion;
		if (lawOpinion == null) continue;
		for (const law of activeLaws) rate += lawOpinion[law] ?? 0;
	}

	// ── TraitJob (`:219`) ───────────────────────────────────────────────────
	// Over every job the character holds, which is `isJob` (Character.cs:9328)
	// rather than `getJob`. Kept because the sum is a transcription of the
	// game's function and `aiJobOpinion` is a live column of trait.xml — it
	// just happens to be empty today (0 of its 306 entries set it), so the
	// term contributes nothing until a patch fills it in.
	const heldJobs = jobsOf(game, characterXmlId, playerXmlId);
	for (const trait of traits) {
		const jobOpinion = TRAIT_OPINION[trait]?.jobOpinion;
		if (jobOpinion == null) continue;
		for (const job of heldJobs) rate += jobOpinion[job] ?? 0;
	}

	// ── LeaderSpouse (`:242`) ───────────────────────────────────────────────
	// `isSpouseOf` (Character.cs:6684) asks whether the leader is in the
	// character's `<Spouses>` list, which is the live list — a divorce removes
	// the id, so the blob's always-null `divorced_turn` is not a filter here
	// either.
	if (
		leaderId != null &&
		game.character_marriages.some(
			(m) =>
				m.character_xml_id === characterXmlId && m.spouse_xml_id === leaderId,
		)
	) {
		rate += OPINION_GLOBALS.leaderSpouse;
	}

	// ── Heir (`:253`) ───────────────────────────────────────────────────────
	const heir = heirTerm(game, player, characterXmlId);
	rate += heir.value;
	// Unresolved, the term is worth 0 or the full HEIR_OPINION and nothing in
	// between — one character per player gets it.
	if (heir.unresolved) slackHigh += OPINION_GLOBALS.heir;

	// ── Parent (`:264`) ─────────────────────────────────────────────────────
	// `leader().isChildOf(pCharacter)` — the leader's own parent is this
	// character. `isChildOf` (Character.cs:1613) is `getAncestorLevel() == 1`
	// over `father()`/`mother()`, the SOCIAL parents, so the birth ids are the
	// wrong pair to read.
	if (leader != null) {
		if (leader.father_xml_id === undefined) {
			slackHigh += OPINION_GLOBALS.parent;
		} else if (
			leader.father_xml_id === characterXmlId ||
			leader.mother_xml_id === characterXmlId
		) {
			rate += OPINION_GLOBALS.parent;
		}
	}

	// ── Job (`:275`) ────────────────────────────────────────────────────────
	// `job.xml`'s own `iOpinion` for the ONE job `getJob` returns, plus
	// `getJobOpinionRate` for it. `Character.getJob` (Character.cs:9364) tests
	// GENERAL_JOB first, so a unit general's job is JOB_GENERAL whatever else
	// they hold — and `heldJobs` is in that same precedence order. The rate's
	// only source game-wide is EFFECTPLAYER_BANNER_OF_LOYALTY, which reaches a
	// player through TRAIT_BANNER_OF_LOYALTY on their leader, so the leader's
	// traits are what answer it.
	const job = heldJobs[0];
	let jobOpinion = JOB_OPINION[job] ?? 0;
	for (const leaderTrait of leaderTraits) {
		jobOpinion += JOB_OPINION_RATE_TRAITS[leaderTrait]?.[job] ?? 0;
	}
	rate += jobOpinion;

	// ── Council (`:298`) ────────────────────────────────────────────────────
	const councils = game.player_councils ?? null;
	if (councils == null) {
		// Every one of council.xml's three seats is worth the same, so the most
		// an unknown seat can be worth is any of them.
		slackHigh += Math.max(0, ...Object.values(COUNCIL_OPINION));
	} else {
		for (const seat of councils) {
			if (seat.player_xml_id !== playerXmlId) continue;
			if (seat.character_xml_id !== characterXmlId) continue;
			rate += COUNCIL_OPINION[seat.position] ?? 0;
		}
	}

	// ── LeaderReligion (`:411`) ─────────────────────────────────────────────
	if (character.religion != null && leader?.religion != null) {
		const step = OPINION_GLOBALS.leaderReligion;
		let change = 0;
		if (leader.religion === character.religion) {
			change += step;
		} else if (RELIGION_WORLD_CLASS[character.religion] === "world") {
			change -= step;
		}
		rate += doubledForHead(change, isReligionHead);
		// Unknown head: the term is either `change` or twice it, so the slack is
		// one more `change` in whichever direction it points.
		if (!headKnown) {
			slackLow += Math.min(0, change);
			slackHigh += Math.max(0, change);
		}
	}

	// ── StateReligion (`:459`) ──────────────────────────────────────────────
	if (character.religion != null && player.state_religion != null) {
		const step = OPINION_GLOBALS.stateReligion;
		let change = 0;
		if (player.state_religion === character.religion) {
			change += step;
		} else {
			// A pagan religion is only half an offence against the state one.
			change -=
				RELIGION_WORLD_CLASS[character.religion] === "pagan"
					? Math.trunc(step / 2)
					: step;
		}
		rate += doubledForHead(change, isReligionHead);
		if (!headKnown) {
			slackLow += Math.min(0, change);
			slackHigh += Math.max(0, change);
		}
	}

	// ── Ethnicity (`:385`) ──────────────────────────────────────────────────
	// ETHNICITY: not computed, and it would need three things the blob doesn't
	// carry. `calculateCharacterOpinionEthnicityPlayer` (`:329`) skips a
	// player on the same TEAM — team assignment reaches no wire type — reads
	// `getTeamDiplomacy` between those teams, and gates on
	// `pCharacter.getAge() >= TUTORS_AGE`, where `getAge` goes through
	// `Game.turnsToYears` (Game.cs:5159) and so through the turn scale, which
	// is a root attribute of the save that nothing parses. Its tribe half
	// (`:357`) additionally needs `isTribeDead`. What bounds the gap: the term
	// is zero unless the character's own nation or tribe differs from their
	// player's, and no unit general in the corpus is in that position — 0 of
	// 193, against 22 foreign-nation and 32 tribal characters among the 3,358
	// player-owned characters overall.

	return settle(rate, slackLow, slackHigh);
}

/**
 * Resolve a rate to its band, and decide whether the slack an unanswered term
 * leaves is enough to reach a different one.
 */
function settle(
	rate: number,
	slackLow: number,
	slackHigh: number,
): CharacterOpinion {
	const band = opinionBand(rate);
	return {
		rate,
		band: band.type,
		strengthModifier: band.strengthModifier,
		uncertain:
			opinionBand(rate + slackLow).type !== band.type ||
			opinionBand(rate + slackHigh).type !== band.type,
	};
}

/** `isReligionHead()` doubles both religion terms (`:452`, `:493`). */
function doubledForHead(change: number, isReligionHead: boolean): number {
	return isReligionHead ? change * 2 : change;
}

function traitsOf(game: OpinionGame, characterXmlId: number): string[] {
	return game.character_traits
		.filter((t) => t.character_xml_id === characterXmlId)
		.map((t) => t.trait_name);
}

/**
 * The jobs this character holds, in `Character.getJob`'s own precedence
 * order. GENERAL_JOB is first because the caller has already established that
 * the character leads one of this player's units, and because `getJob`
 * (`:9364`) tests it before anything else. A council seat is the other job
 * the blob can name; explorer, governor and agent hang off `isUnitExplorer` /
 * `isCityGovernor` / `isCityAgent`, and GENERAL_JOB outranks all three.
 */
function jobsOf(
	game: OpinionGame,
	characterXmlId: number,
	playerXmlId: number,
): string[] {
	const jobs: string[] = [GENERAL_JOB];
	for (const seat of game.player_councils ?? []) {
		if (seat.player_xml_id !== playerXmlId) continue;
		if (seat.character_xml_id !== characterXmlId) continue;
		// A seat is a COUNCIL_*; the job it makes the holder is a JOB_*.
		const seatJob = COUNCIL_JOBS[seat.position];
		if (seatJob != null) jobs.push(seatJob);
	}
	return jobs;
}

/**
 * `heir() == pCharacter` — and `heir()` (Player.cs:12339) is the first id of a
 * succession list the save never writes. `findHeir` (`:12287`) puts an
 * eligible `chosenHeir()` at the head of it, so `<ChosenHeirID>` answers the
 * nominated case outright.
 *
 * The unnominated case is left unresolved rather than re-derived: it needs
 * `findPrimogenitureHeir` / `findUltimogenitureHeir` / `findLateralHeir` /
 * `findDynasticHeir` / `findSeniorityHeir` (Player.cs:12390–12723), some 500
 * lines of family-tree walking, for a term worth 20 — a fifth of a band's
 * width. It reports `unresolved` instead, which the caller turns into slack.
 */
function heirTerm(
	game: OpinionGame,
	player: OpinionGame["game_details"]["players"][number],
	characterXmlId: number,
): { value: number; unresolved: boolean } {
	const chosen = player.chosen_heir_xml_id;
	// Absent: a blob from before 2.24.0, where the nomination is unknown. Null
	// or the game's -1 sentinel: no nomination, so succession law picks and we
	// don't follow it.
	if (chosen == null || chosen < 0) return { value: 0, unresolved: true };

	const nominee = game.characters.find((c) => c.xml_id === chosen);
	if (nominee == null) return { value: 0, unresolved: true };

	// An ineligible nominee means succession law picks after all, and then the
	// heir could be anyone — including this character.
	if (!isSuccessionEligible(game, player, nominee)) {
		return { value: 0, unresolved: true };
	}
	// The nominee IS the heir, so the term is settled either way.
	return {
		value: chosen === characterXmlId ? OPINION_GLOBALS.heir : 0,
		unresolved: false,
	};
}

/**
 * `Character.isSuccessionEligible` (Character.cs:3047) for the nominated heir.
 * Every clause is derivable from the blob: the gender gate from the player's
 * succession rule, leader and ex-leader status from `became_leader_turn`,
 * liveness from `death_turn`, and the two trait gates from the baked sets. A
 * player carrying no succession gender (a pre-2.24.0 blob) fails the gate,
 * which is what sends the caller down the unresolved arm.
 */
function isSuccessionEligible(
	game: OpinionGame,
	player: OpinionGame["game_details"]["players"][number],
	nominee: CharacterInfo,
): boolean {
	const rule =
		player.succession_gender != null
			? SUCCESSION_GENDERS[player.succession_gender]
			: undefined;
	if (rule == null) return false;

	if (rule.singleGender && nominee.gender !== rule.gender) return false;
	// `isLeader()`.
	if (nominee.xml_id === player.leader_character_xml_id) return false;
	// `isOrWasLeader()` is `getLeaderTurn() != int.MinValue`, i.e. a recorded
	// accession turn; such a character needs a trait to re-enter the line.
	const traits = traitsOf(game, nominee.xml_id);
	if (
		nominee.became_leader_turn != null &&
		!traits.some((t) => SUCCESSION_RETURN_TRAITS.includes(t))
	) {
		return false;
	}
	if (nominee.player_xml_id !== player.player_id) return false;
	if (nominee.death_turn != null) return false;
	return !traits.some((t) => NO_SUCCESSION_TRAITS.includes(t));
}

/**
 * `Game.getAdjustedMemoryValue` (Game.cs:3229) — a memory decays linearly
 * across its window, and never all the way to nothing: a value that rounds to
 * 0 is floored to ±1. C# integer division truncates toward zero, hence
 * `Math.trunc`.
 */
function adjustedMemoryValue(
	value: number,
	turns: number,
	startTurn: number,
	now: number,
): number {
	if (value === 0) return 0;
	if (turns <= 0) return value;
	const adjusted = Math.trunc(((turns - (now - startTurn)) * value) / turns);
	if (adjusted !== 0) return adjusted;
	return value > 0 ? 1 : -1;
}
