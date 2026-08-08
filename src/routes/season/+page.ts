// Public Season page — the games-played leaderboard. Anonymous endpoint,
// same audience as the home discovery feed. The season is picked via the
// `?s=` slug (shareable, e.g. ?s=summer-2026), defaulting to the current
// one; past seasons are closed windows the archive keeps forever.
import { cloudApi } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

export interface Season {
	name: string;
	year: number;
	label: string; // "Summer 2026"
	range: string; // "Jun–Aug"
	slug: string; // "summer-2026"
	since: string; // inclusive YYYY-MM-DD
	until: string; // exclusive YYYY-MM-DD
}

// Seasons follow the meteorological quarters the community actually says
// out loud: Spring Mar–May, Summer Jun–Aug, Fall Sep–Nov, Winter Dec–Feb
// (owned by the year it starts in, so Jan/Feb 2027 are still Winter 2026).
// Seasons exist from per-ankh's first, Summer 2026; earlier games live
// only in all-time.
const SEASON_DEFS = [
	{ name: "Spring", startMonth: 2, range: "Mar–May" },
	{ name: "Summer", startMonth: 5, range: "Jun–Aug" },
	{ name: "Fall", startMonth: 8, range: "Sep–Nov" },
	{ name: "Winter", startMonth: 11, range: "Dec–Feb" },
] as const;
const EPOCH = { year: 2026, index: 1 }; // Summer 2026

function seasonAt(year: number, index: number): Season {
	const def = SEASON_DEFS[index];
	const sinceY = year;
	const sinceM = def.startMonth + 1;
	// Exclusive end: three months on (Winter rolls into the next year).
	const untilY = index === 3 ? year + 1 : year;
	const untilM = index === 3 ? 3 : def.startMonth + 4;
	return {
		name: def.name,
		year,
		label: `${def.name} ${year}`,
		range: def.range,
		slug: `${def.name.toLowerCase()}-${year}`,
		since: `${sinceY}-${String(sinceM).padStart(2, "0")}-01`,
		until: `${untilY}-${String(untilM).padStart(2, "0")}-01`,
	};
}

// Every season from the epoch through today, chronological — the picker's
// list. Grows by itself as time passes; no deploy rolls a season over.
function allSeasons(now = new Date()): Season[] {
	const out: Season[] = [];
	let y = EPOCH.year;
	let i = EPOCH.index;
	const today = now.toISOString().slice(0, 10);
	for (;;) {
		const s = seasonAt(y, i);
		if (s.since > today) break;
		out.push(s);
		i++;
		if (i === 4) {
			i = 0;
			y++;
		}
	}
	return out;
}

export const load: PageLoad = async ({ fetch, url }) => {
	const seasons = allSeasons();
	const slug = url.searchParams.get("s");
	const selected =
		seasons.find((s) => s.slug === slug) ?? seasons[seasons.length - 1];
	const [allTime, seasonBoard] = await Promise.all([
		cloudApi.getPlayerLeaderboard({ fetch }),
		cloudApi.getPlayerLeaderboard({
			fetch,
			since: selected.since,
			until: selected.until,
		}),
	]);
	return {
		allTime: allTime.players,
		season: seasonBoard.players,
		seasons,
		selected,
	};
};
