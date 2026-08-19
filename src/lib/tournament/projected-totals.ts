// Projected whole-tournament match totals for the header's progress hero.
//
// The double-threshold Swiss makes the eventual match count *nearly*
// deterministic: within a record bucket, every game sends one player up and
// one down regardless of who wins, so bucket sizes — and with them each
// round's match count — evolve identically under any results. The one
// exception is a cross-record game (an odd bucket's floater playing down):
// its outcome changes how many players leave the field that round, shifting
// later rounds by a match. This walks every such branch and reports the
// min/max envelope — for a real field the spread is 0 or 1, so the header can
// show an exact number or a close "~N".
//
// The championship is single-elimination over every advancer ("no cap" — see
// docs/tournament-rules.md), so its playable match count is exactly
// qualifiers − 1. Advancer counts are tracked through the same branch walk;
// in practice the floater branches cancel (one more player advancing at 3-1
// means one fewer game in the 2-2 bucket next round) and the qualifier count
// comes out deterministic even when the match count doesn't.
//
// Cross-checked against the real pairing engine (pairSwissRound) over
// randomized futures in cloud/src/tournament/projected-totals.test.ts — the
// SvelteKit tree has no test runner, and that suite is where the engine is
// importable.

export interface SwissProjection {
	// Matches still to be GENERATED in future rounds (excludes matches that
	// already exist, pending or decided).
	remainingMin: number;
	remainingMax: number;
	// Players who reach the win threshold by the end of Swiss, including those
	// already advanced.
	qualifiersMin: number;
	qualifiersMax: number;
}

interface Config {
	winsToAdvance: number;
	lossesToEliminate: number;
}

type Rec = { wins: number; losses: number };

// One resolved future: match/qualifier tallies plus the census of active
// records ("w-l" → player count) feeding the next round.
interface BranchState {
	census: Map<string, number>;
	matches: number;
	qualifiers: number;
}

const key = (r: Rec) => `${r.wins}-${r.losses}`;

// Branch identity: two futures holding the same census with the same tallies
// are interchangeable from here on, so only one needs walking. Every
// cross-record game forks, and without collapsing on this k such games cost
// 2^k branches instead of the k+1 distinct outcomes they actually produce.
const signature = (b: BranchState) =>
	`${[...b.census.entries()].sort().join()}|${b.matches}|${b.qualifiers}`;

function bump(census: Map<string, number>, r: Rec, by: number) {
	const k = key(r);
	const next = (census.get(k) ?? 0) + by;
	if (next === 0) census.delete(k);
	else census.set(k, next);
}

// Move a game's winner and loser into `next`, pruning advancers/eliminated
// and counting the advancers. Returns the qualifier increment.
function settle(
	next: Map<string, number>,
	winner: Rec,
	loser: Rec,
	config: Config,
): number {
	let qualified = 0;
	if (winner.wins + 1 >= config.winsToAdvance) qualified++;
	else bump(next, { wins: winner.wins + 1, losses: winner.losses }, 1);
	if (loser.losses + 1 < config.lossesToEliminate)
		bump(next, { wins: loser.wins, losses: loser.losses + 1 }, 1);
	return qualified;
}

// Best-record-first buckets, matching the pairing sort (wins desc, losses
// asc). Records minted during a round belong to the NEXT round's census, so
// this is computed once per round from its start state.
function sortedBuckets(census: Map<string, number>): Array<[Rec, number]> {
	return [...census.entries()]
		.map(([k, n]) => {
			const [w, l] = k.split("-").map(Number);
			return [{ wins: w, losses: l }, n] as [Rec, number];
		})
		.sort((a, b) => b[0].wins - a[0].wins || a[0].losses - b[0].losses);
}

// Simulate one future round: consume the start-of-round buckets top-down —
// bucket fold, odd bucket floats one down, worst-ranked bye on an odd field —
// building each branch's next-round census. Only a floater's cross-record
// game forks; same-record games move one player each way under any result.
function playRound(start: BranchState, config: Config): BranchState[] {
	const buckets = sortedBuckets(start.census);
	const total = buckets.reduce((acc, [, n]) => acc + n, 0);
	// Only an empty field ends the walk. One active player still plays every
	// remaining round — the engine hands the lone slot a bye each time, and
	// those free wins can carry them to the advance threshold, so stopping at
	// two would under-count qualifiers.
	if (total === 0) return [start];

	interface Frame {
		next: Map<string, number>;
		matches: number;
		qualifiers: number;
	}
	const first: Frame = {
		next: new Map<string, number>(),
		matches: start.matches,
		qualifiers: start.qualifiers,
	};
	if (total % 2 === 1) {
		// Odd field: the worst-ranked active takes the bye — recorded as a free
		// win, which can itself advance a player one short of the threshold.
		//
		// Approximation: the engine skips players who already had a bye
		// (pickByeRecipient), which a record census can't see. That only bites
		// once the field has run out of never-byed players and someone takes a
		// SECOND bye — until then the worst-ranked slot is a fresh player every
		// round and this guess is exact. Byes are not rare on an even field:
		// advancers and eliminated players don't leave in pairs, so parity
		// flips mid-Swiss (a 28-player division byes in about half of its
		// futures). It's the REPEAT that needs a field small enough to exhaust
		// them — measured against the engine, none at n >= 6 under 3W/3L,
		// including the odd 27 and 29 that take a bye every single round.
		const [rec, n] = buckets[buckets.length - 1];
		buckets[buckets.length - 1] = [rec, n - 1];
		if (rec.wins + 1 >= config.winsToAdvance) first.qualifiers += 1;
		else bump(first.next, { wins: rec.wins + 1, losses: rec.losses }, 1);
	}
	let frames: Array<{ f: Frame; floater: Rec | null }> = [
		{ f: first, floater: null },
	];

	for (const [rec, count] of buckets) {
		const forked: Array<{ f: Frame; floater: Rec | null }> = [];
		for (const fr of frames) {
			let n = count;
			const f = fr.f;
			// Floater from the bucket above plays this bucket's top player — a
			// cross-record game; fork on its outcome.
			if (fr.floater && n > 0) {
				const fl = fr.floater;
				n -= 1;
				const win: Frame = {
					next: new Map(f.next),
					matches: f.matches + 1,
					qualifiers: f.qualifiers,
				};
				win.qualifiers += settle(win.next, fl, rec, config);
				const lose: Frame = {
					next: new Map(f.next),
					matches: f.matches + 1,
					qualifiers: f.qualifiers,
				};
				lose.qualifiers += settle(lose.next, rec, fl, config);
				const games = Math.floor(n / 2);
				for (const half of [win, lose]) {
					half.matches += games;
					for (let g = 0; g < games; g++)
						half.qualifiers += settle(half.next, rec, rec, config);
				}
				const leftover = n % 2 === 1 ? rec : null;
				forked.push({ f: win, floater: leftover });
				forked.push({ f: lose, floater: leftover });
			} else {
				// No floater (or nobody here to meet one — then it keeps falling).
				const games = Math.floor(n / 2);
				f.matches += games;
				for (let g = 0; g < games; g++)
					f.qualifiers += settle(f.next, rec, rec, config);
				forked.push({
					f,
					floater: n % 2 === 1 ? rec : (fr.floater ?? null),
				});
			}
		}
		frames = forked;
	}

	return frames.map((fr) => {
		// A floater with no bucket below is structurally impossible on an even
		// field; defensively carry them into the next round unplayed.
		if (fr.floater) bump(fr.f.next, fr.floater, 1);
		return {
			census: fr.f.next,
			matches: fr.f.matches,
			qualifiers: fr.f.qualifiers,
		};
	});
}

// Project a division's remaining Swiss matches and eventual qualifier count.
//
// `active` — current W-L of every still-active, non-withdrawn slot, counting
// decided matches only. `pendingPairs` — the record pairs of already-generated
// but unreported matches (they resolve first; a same-record pair needs no
// branch). `roundsLeft` — Swiss rounds not yet generated.
export function projectSwissDivision(
	active: Rec[],
	pendingPairs: Array<[Rec, Rec]>,
	roundsLeft: number,
	config: Config,
	alreadyQualified: number,
): SwissProjection {
	const census = new Map<string, number>();
	for (const r of active) bump(census, r, 1);
	let branches: BranchState[] = [
		{ census, matches: 0, qualifiers: alreadyQualified },
	];

	// Resolve the current round's open matches into the census. A pair whose
	// participants aren't (both) in the active census — a withdrawn player's
	// not-yet-forfeited match, or records out of sync with the standings —
	// is skipped rather than driving a count negative: the walk degrades to
	// ignoring that game instead of corrupting every later round.
	for (const [a, b] of pendingPairs) {
		const same = a.wins === b.wins && a.losses === b.losses;
		const forked: BranchState[] = [];
		const seen = new Set<string>();
		// Collapse duplicates as they land: a round's pending list repeats the
		// same record pairing many times over, and the outcomes commute — only
		// how many of them the higher record won reaches the next round.
		const keep = (br: BranchState) => {
			const sig = signature(br);
			if (seen.has(sig)) return;
			seen.add(sig);
			forked.push(br);
		};
		for (const br of branches) {
			const present = same
				? (br.census.get(key(a)) ?? 0) >= 2
				: (br.census.get(key(a)) ?? 0) >= 1 &&
					(br.census.get(key(b)) ?? 0) >= 1;
			if (!present) {
				keep(br);
				continue;
			}
			bump(br.census, a, -1);
			bump(br.census, b, -1);
			if (same) {
				br.qualifiers += settle(br.census, a, b, config);
				keep(br);
			} else {
				const win: BranchState = {
					census: new Map(br.census),
					matches: br.matches,
					qualifiers: br.qualifiers,
				};
				win.qualifiers += settle(win.census, a, b, config);
				br.qualifiers += settle(br.census, b, a, config);
				keep(win);
				keep(br);
			}
		}
		branches = forked;
	}

	for (let r = 0; r < roundsLeft; r++) {
		const next: BranchState[] = [];
		const seen = new Set<string>();
		for (const b of branches) {
			for (const nb of playRound(b, config)) {
				const sig = signature(nb);
				if (!seen.has(sig)) {
					seen.add(sig);
					next.push(nb);
				}
			}
		}
		branches = next;
	}

	const matches = branches.map((b) => b.matches);
	const quals = branches.map((b) => b.qualifiers);
	return {
		remainingMin: Math.min(...matches),
		remainingMax: Math.max(...matches),
		qualifiersMin: Math.min(...quals),
		qualifiersMax: Math.max(...quals),
	};
}
