// Which map should this pair play?
//
// A sibling of assignMap() in ../tournament/maps.ts, which answers the same
// question when a round is generated, and by the same rule: prefer a script
// neither of them has played, and when that is impossible, the one they have
// played least between them. Deliberately not the same function. That one is
// written in tournament terms — slot ids, a MatchRef history, which scripts are
// already used elsewhere in this round, which options-variant of a script a
// pair has seen — and reaching it from here would mean fabricating matches and
// a round that do not exist. What the two genuinely share is two lines of set
// arithmetic and, more importantly, the domain rule: the unit of "same map" is
// the script, not the exact configuration. Keep those two in step.
//
// The pool is the atlas' published pool (../generated/atlas-pool): the
// duel-tuned configurations the community actually plays, and the only ones
// whose anchors resolve on the atlas site, so every suggestion can be linked.

import { ATLAS_POOL, type AtlasPoolMap } from "../generated/atlas-pool";
import { canonicalMapScript } from "../tournament/canonical-maps";

// How far back "you have played this lately" reaches. Old World games run for
// weeks and a player's rated history here spans years, so a lifetime memory
// would rule out every map a veteran has ever touched and leave nothing to
// suggest. Half a year is long enough that a suggestion feels like a change of
// scene, short enough that the pool doesn't collapse.
export const MAP_MEMORY_DAYS = 180;

// Play counts by canonical script (canonicalMapScript), for one player.
export type ScriptPlays = ReadonlyMap<string, number>;

/**
 * Pick a map for a pair from their recent script history.
 *
 * `usedScripts` is the set of canonical scripts already suggested elsewhere on
 * the same list, and it outranks the play counts. That ordering is deliberate:
 * the pool holds several configurations of some scripts and one of others, and
 * within one page the counts separating them are a game or two, so letting the
 * count win returns the same popular script most of the way down the page. A
 * map played once more than the alternative is a better suggestion than the
 * ninth copy of DOTA. The tournament engine has the same objective for the
 * matches of one round, for the same reason.
 *
 * `rng` decides among equally good candidates — seed it per pair.
 *
 * Returns null only if the baked pool is empty.
 */
export function pickMap(
	playsA: ScriptPlays,
	playsB: ScriptPlays,
	rng: () => number,
	usedScripts: ReadonlySet<string> = new Set(),
): AtlasPoolMap | null {
	if (ATLAS_POOL.length === 0) return null;

	const plays = (m: AtlasPoolMap): number => {
		const script = canonicalMapScript(m.script);
		return (playsA.get(script) ?? 0) + (playsB.get(script) ?? 0);
	};

	// Fewest games between them, which at zero is the map neither has played —
	// the whole point, since a map one of them knows and the other doesn't is
	// the least even start there is.
	const leastPlayed = (from: readonly AtlasPoolMap[]): AtlasPoolMap => {
		const fewest = Math.min(...from.map(plays));
		const tier = from.filter((m) => plays(m) === fewest);
		return tier[Math.floor(rng() * tier.length)];
	};

	const unused = ATLAS_POOL.filter(
		(m) => !usedScripts.has(canonicalMapScript(m.script)),
	);
	return leastPlayed(unused.length > 0 ? unused : ATLAS_POOL);
}
