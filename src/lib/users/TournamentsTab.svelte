<script lang="ts">
	// One player's tournament record (issue #154) — match-shaped, not save-shaped.
	// A tournament match links exactly one save, so the Games tab (keyed on the
	// uploader) holds at most half a player's tournament games and none of their
	// upcoming ones; a cast isn't a game at all. Three sections, from one lazy
	// fetch of GET /v1/users/:user_id/tournaments (the Videos-tab precedent):
	//
	//   Enrollment — the tournaments they hold a seat in. What keeps the tab from
	//     being contentless between signup and the first generated round, and the
	//     only way a visitor learns from this side that they're in an upcoming one.
	//   Matches    — played and upcoming in one list, grouped by tournament.
	//   Casts      — separate, because the grain differs: casting is per-sitting,
	//     so a player can cast one sitting of a two-sitting match. A played match
	//     is a match row, a cast is a part row; interleaving them would also
	//     produce two near-identical rows for a player who played one match and
	//     cast a sitting of another.
	//
	// Rows render through the shared MatchTable, one table per tournament group —
	// that's what lets each group carry its own compact tournament context
	// (division names + map pool) instead of a TournamentDetail per group. The
	// `actions` column is omitted: this surface is read-only, so no inline cast
	// sign-up. Results come from the tournament's own winner_slot_id (rendered as
	// winner emphasis in the matchup cell), not the save's is_winner, so the tab
	// can't contradict the standings it links to.
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import type {
		TournamentMatch,
		UserTournamentCast,
		UserTournamentEntry,
		UserTournamentsResponse,
	} from "$lib/api-cloud";
	import { matchBracketLabel } from "$lib/tournament/bracket-label";
	import { headerStatusMeta } from "$lib/tournament/header-status";
	import MatchTable from "$lib/tournament/MatchTable.svelte";
	import {
		pickColumns,
		sortMatchRows,
		toMatchRows,
		MATCH_TABLE_FRAME_CLASS,
		MATCH_TABLE_ROW_CLASS,
		MATCH_TABLE_TD_CLASS,
		MATCH_TABLE_TH_CLASS,
		type MatchRow,
	} from "$lib/tournament/matches-table";
	import { matchParts } from "$lib/tournament/parts";

	let { record }: { record: UserTournamentsResponse } = $props();

	// Time column first, then the matchup: the same order the tournament's own
	// match surfaces use. No `actions` (read-only) and no `onSort` — the time
	// column's comparator already reads live/overdue → upcoming → played, which
	// is the order a profile wants, and per-group sort state would be noise.
	const columns = pickColumns(["time", "matchup", "broadcast"]);

	// Profiles have no tournament-page zone toggle to inherit, so times render in
	// the viewer's own clock.
	const ZONE = "local" as const;

	const enrolled = $derived(
		record.tournaments.filter((t) => t.slots.length > 0),
	);

	// One group per tournament, in the payload's order (newest tournament first).
	interface Group {
		tournament: UserTournamentEntry;
		rows: MatchRow[];
	}

	// Groups follow the payload's tournament order (newest first); a tournament
	// with no rows in this section is skipped rather than shown as an empty table.
	// eslint-disable-next-line no-unused-vars -- documentary param name
	function group(rowsFor: (tournamentId: string) => MatchRow[]): Group[] {
		const out: Group[] = [];
		for (const tournament of record.tournaments) {
			const rows = rowsFor(tournament.tournament_id);
			if (rows.length === 0) continue;
			out.push({
				tournament,
				// Ascending by the shared `time` comparator: live/overdue first, then
				// upcoming soonest-first, with unscheduled and played rows pinned last
				// by its nulls-last rule.
				rows: sortMatchRows(rows, "time", "asc", {
					slotLabels: record.slot_labels,
				}),
			});
		}
		return out;
	}

	// toMatchRows applies the shared bye filter and split flag, one row per match.
	const matchGroups = $derived(
		group((id) =>
			toMatchRows(record.matches.filter((m) => m.tournament_id === id)),
		),
	);

	// A cast is a PART row: the sitting the player actually cast. part_id names it;
	// a cast whose part has since been deleted from the blob is dropped.
	function castRow(cast: UserTournamentCast): MatchRow | null {
		const parts = matchParts(cast);
		const index = parts.findIndex((p) => p.id === cast.part_id);
		if (index < 0) return null;
		return {
			match: cast,
			part: parts[index],
			partNumber: index + 1,
			split: parts.length >= 2,
		};
	}

	const castGroups = $derived(
		group((id) =>
			record.casts
				.filter((c) => c.tournament_id === id)
				.map(castRow)
				.filter((r): r is MatchRow => r !== null),
		),
	);

	const isEmpty = $derived(
		enrolled.length === 0 &&
			matchGroups.length === 0 &&
			castGroups.length === 0,
	);

	// A row's destination: the linked save when one exists, otherwise the
	// tournament page's match popover via its existing ?match= deep link (an
	// upcoming or in-progress match has no save yet).
	async function openRow(match: TournamentMatch, slug: string) {
		if (match.game_id) {
			await goto(resolve("/games/[id]", { id: match.game_id }));
			return;
		}
		const href = `${resolve("/tournaments/[slug]", { slug })}?match=${match.match_id}`;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic query string on a resolve()d route; resolve()'s branded types don't admit one
		await goto(href);
	}

	// Each slot's bracket label reuses the shared match labeler: "Championship"
	// for a championship seat, otherwise the tournament's configured division
	// name. A player in the championship holds both seats, hence a line each.
	function slotSeed(slot: UserTournamentEntry["slots"][number]): number | null {
		return slot.phase === "championship"
			? slot.championship_seed
			: slot.swiss_seed;
	}

	const panelClass = "rounded-lg p-4";
	const panelStyle = "background-color: rgb(var(--color-surface-sunken));";
	const headingClass =
		"mb-3 text-sm font-bold uppercase tracking-wide text-tan";
</script>

<!-- The tournament name + status chip that heads each match/cast group, and
     doubles as the Enrollment row's first cell. -->
{#snippet tournamentLink(t: UserTournamentEntry)}
	{@const meta = headerStatusMeta(t.status, t.signups_open)}
	<span class="inline-flex items-center gap-2">
		<a
			href={resolve("/tournaments/[slug]", { slug: t.slug })}
			class="font-bold text-bright hover:text-orange hover:underline"
		>
			{t.name}
		</a>
		<span
			class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide {meta.chipClass}"
		>
			{meta.label}
		</span>
	</span>
{/snippet}

<div class="flex flex-col gap-4">
	{#if isEmpty}
		<div class={panelClass} style={panelStyle}>
			<div class="py-8 text-center text-sm text-gray-400">
				No tournament activity yet.
			</div>
		</div>
	{/if}

	{#if enrolled.length > 0}
		<section class={panelClass} style={panelStyle}>
			<h3 class={headingClass}>Enrollment</h3>
			<!-- Same framed-box chrome as the MatchTable it stacks above, from the
			     shared constants so the two can't drift apart. -->
			<div class={MATCH_TABLE_FRAME_CLASS}>
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr>
							<th class={MATCH_TABLE_TH_CLASS}>Tournament</th>
							<th class={MATCH_TABLE_TH_CLASS}>Bracket</th>
							<th class={MATCH_TABLE_TH_CLASS}>Seed</th>
						</tr>
					</thead>
					<tbody>
						{#each enrolled as t (t.tournament_id)}
							<tr class={MATCH_TABLE_ROW_CLASS}>
								<td class={MATCH_TABLE_TD_CLASS}>{@render tournamentLink(t)}</td
								>
								<!-- Both cells walk `slots` in the same order, so a
								     championship participant's two lines stay aligned. -->
								<td class={MATCH_TABLE_TD_CLASS}>
									{#each t.slots as slot (slot.slot_id)}
										<div>
											{matchBracketLabel(t, {
												phase: slot.phase,
												division: slot.division,
											}) || "—"}
										</div>
									{/each}
								</td>
								<td class={MATCH_TABLE_TD_CLASS}>
									{#each t.slots as slot (slot.slot_id)}
										{@const seed = slotSeed(slot)}
										<div>{seed ?? "—"}</div>
									{/each}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	{#if matchGroups.length > 0}
		<section class={panelClass} style={panelStyle}>
			<h3 class={headingClass}>Matches</h3>
			<div class="flex flex-col gap-4">
				{#each matchGroups as g (g.tournament.tournament_id)}
					<div>
						<div class="mb-2">{@render tournamentLink(g.tournament)}</div>
						<MatchTable
							{columns}
							rows={g.rows}
							zone={ZONE}
							tournament={g.tournament}
							user={null}
							slotLabels={record.slot_labels}
							slotAvatars={record.slot_avatars}
							onRowClick={(m) => openRow(m, g.tournament.slug)}
						/>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if castGroups.length > 0}
		<section class={panelClass} style={panelStyle}>
			<h3 class={headingClass}>Casts</h3>
			<div class="flex flex-col gap-4">
				{#each castGroups as g (g.tournament.tournament_id)}
					<div>
						<div class="mb-2">{@render tournamentLink(g.tournament)}</div>
						<MatchTable
							{columns}
							rows={g.rows}
							zone={ZONE}
							tournament={g.tournament}
							user={null}
							slotLabels={record.slot_labels}
							slotAvatars={record.slot_avatars}
							onRowClick={(m) => openRow(m, g.tournament.slug)}
						/>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>
