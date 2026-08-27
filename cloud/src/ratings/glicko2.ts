// Glicko-2 rating engine — a faithful TypeScript port of owglick's
// scripts/ratings.py `glicko2()` (the sibling Old World duel-ladder project).
// Kept byte-faithful to that reference so per-ankh's ratings match the
// community's established ladder; see ratings/glicko2.test.ts, which checks
// this port against golden vectors generated from the Python original.
//
// Algorithm: standard Glicko-2 (Glickman) with monthly rating periods. Each
// player starts at r=1500, RD=350, vol=0.06. A period aggregates every duel a
// player fought that month into one update; a player with no games that month
// only has their RD inflated by volatility (Glicko-2 "Step 6"). Volatility is
// solved by the Illinois-variant bisection from the Glicko-2 paper.

// Conversion factor between the public rating scale and the internal (mu/phi)
// scale, and the system volatility constant tau. Match ratings.py exactly.
//
// SCALE is exported because the recommender works on the internal scale too:
// the Fisher information a prospective game carries is a statement about phi,
// and converting it back to rating points is what makes "how much would this
// game settle you" comparable across players. Same constant, one definition.
export const SCALE = 173.7178;
const DEFAULT_TAU = 0.5;

const DEFAULT_RATING = 1500.0;
const DEFAULT_RD = 350.0;
const DEFAULT_VOL = 0.06;

// One decisive duel: two player ids, the winner (must equal p1 or p2), and a
// date string whose first 7 chars are the YYYY-MM rating period.
export interface Duel {
	date: string;
	p1: string;
	p2: string;
	winner: string;
}

export interface Glicko2Result {
	r: number;
	rd: number;
	vol: number;
	games: number;
}

// The two quantities a Glicko-2 update is built out of, exported for the
// recommender (cloud/src/ratings/recommend.ts), which scores a *prospective*
// game with the same arithmetic an actual result would be scored with. Keeping
// them here rather than restating them there is what guarantees the model the
// recommendations come from is the model the ratings come from.
export function g(phi: number): number {
	return 1.0 / Math.sqrt(1.0 + (3.0 * phi * phi) / (Math.PI * Math.PI));
}

// Player i's win probability against j, both already on the internal scale.
export function expectedScore(mu: number, muJ: number, phiJ: number): number {
	return 1.0 / (1.0 + Math.exp(-g(phiJ) * (mu - muJ)));
}

function round1(x: number): number {
	return Math.round(x * 10) / 10;
}

function round4(x: number): number {
	return Math.round(x * 10000) / 10000;
}

// Run Glicko-2 over a set of duels, returning final {r, rd, vol, games} per
// player id (rounded as ratings.py does). Players are every id that appears in
// any duel. `tau` is the system volatility constant.
export function glicko2(
	duels: readonly Duel[],
	tau: number = DEFAULT_TAU,
): Record<string, Glicko2Result> {
	const sorted = [...duels].sort((x, y) =>
		x.date < y.date ? -1 : x.date > y.date ? 1 : 0,
	);

	const ids = new Set<string>();
	for (const x of sorted) {
		ids.add(x.p1);
		ids.add(x.p2);
	}

	const R = new Map<string, number>();
	const RD = new Map<string, number>();
	const VOL = new Map<string, number>();
	const N = new Map<string, number>();
	for (const i of ids) {
		R.set(i, DEFAULT_RATING);
		RD.set(i, DEFAULT_RD);
		VOL.set(i, DEFAULT_VOL);
		N.set(i, 0);
	}

	// Group into monthly periods (YYYY-MM), processed chronologically.
	const periods = new Map<string, Duel[]>();
	for (const x of sorted) {
		const ym = x.date.slice(0, 7);
		const bucket = periods.get(ym);
		if (bucket) bucket.push(x);
		else periods.set(ym, [x]);
	}

	for (const ym of [...periods.keys()].sort()) {
		// id -> list of [opponentId, score]
		const results = new Map<string, [string, number][]>();
		for (const x of periods.get(ym)!) {
			const { p1: a, p2: b, winner: w } = x;
			(results.get(a) ?? results.set(a, []).get(a)!).push([
				b,
				w === a ? 1.0 : 0.0,
			]);
			(results.get(b) ?? results.set(b, []).get(b)!).push([
				a,
				w === b ? 1.0 : 0.0,
			]);
			N.set(a, N.get(a)! + 1);
			N.set(b, N.get(b)! + 1);
		}

		const newR = new Map(R);
		const newRD = new Map(RD);
		const newVOL = new Map(VOL);

		for (const i of ids) {
			const mu = (R.get(i)! - 1500.0) / SCALE;
			const phi = RD.get(i)! / SCALE;
			const sigma = VOL.get(i)!;
			const matches = results.get(i);

			if (!matches || matches.length === 0) {
				// Step 6: no games this period — only RD grows.
				newRD.set(
					i,
					Math.min(Math.sqrt(phi * phi + sigma * sigma) * SCALE, 350.0),
				);
				continue;
			}

			let vInv = 0.0;
			let deltaSum = 0.0;
			for (const [opp, s] of matches) {
				const muJ = (R.get(opp)! - 1500.0) / SCALE;
				const phiJ = RD.get(opp)! / SCALE;
				const gj = g(phiJ);
				const ej = expectedScore(mu, muJ, phiJ);
				vInv += gj * gj * ej * (1.0 - ej);
				deltaSum += gj * (s - ej);
			}
			const v = 1.0 / vInv;
			const delta = v * deltaSum;

			// Step 5: solve for the new volatility via Illinois bisection.
			const a = Math.log(sigma * sigma);
			const f = (x: number): number => {
				const ex = Math.exp(x);
				const num = ex * (delta * delta - phi * phi - v - ex);
				const den = 2.0 * Math.pow(phi * phi + v + ex, 2);
				return num / den - (x - a) / (tau * tau);
			};
			let A = a;
			let B: number;
			if (delta * delta > phi * phi + v) {
				B = Math.log(delta * delta - phi * phi - v);
			} else {
				let kk = 1;
				while (f(a - kk * tau) < 0) kk += 1;
				B = a - kk * tau;
			}
			let fA = f(A);
			let fB = f(B);
			for (let iter = 0; iter < 100; iter++) {
				const C = A + ((A - B) * fA) / (fB - fA);
				const fC = f(C);
				if (fC * fB <= 0) {
					A = B;
					fA = fB;
				} else {
					fA /= 2.0;
				}
				B = C;
				fB = fC;
				if (Math.abs(B - A) < 1e-6) break;
			}
			const sigmaP = Math.exp(A / 2.0);

			const phiStar = Math.sqrt(phi * phi + sigmaP * sigmaP);
			const phiP = 1.0 / Math.sqrt(1.0 / (phiStar * phiStar) + 1.0 / v);
			const muP = mu + phiP * phiP * deltaSum;

			newR.set(i, muP * SCALE + 1500.0);
			newRD.set(i, Math.min(phiP * SCALE, 350.0));
			newVOL.set(i, sigmaP);
		}

		for (const i of ids) {
			R.set(i, newR.get(i)!);
			RD.set(i, newRD.get(i)!);
			VOL.set(i, newVOL.get(i)!);
		}
	}

	const out: Record<string, Glicko2Result> = {};
	for (const i of ids) {
		out[i] = {
			r: round1(R.get(i)!),
			rd: round1(RD.get(i)!),
			vol: round4(VOL.get(i)!),
			games: N.get(i)!,
		};
	}
	return out;
}
