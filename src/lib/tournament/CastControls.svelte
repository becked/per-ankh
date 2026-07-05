<script lang="ts">
	// Inline caster self-service buttons for one match sitting, hosted in the
	// shared match table's trailing actions column (MatchTable). Any logged-in
	// user can add themselves as the streamer or a co-caster, or drop. Writes go
	// through the self-service cast endpoints (a caster only ever touches their
	// own entry) and refresh via invalidateAll. Rendered on every match surface
	// for pending scheduled sittings — the caller gates on rowIsPendingSitting.
	// The "needs a caster" flag is not here; it lives with the caster/stream data
	// in the Casters & Streams cell.
	import { cloudApi, type TournamentDetail, type UserMe } from "$lib/api-cloud";
	import { rowPart, type MatchRow } from "$lib/tournament/matches-table";
	import { runAction } from "$lib/tournament/async-action";

	let {
		row,
		tournament,
		user,
	}: {
		row: MatchRow;
		tournament: TournamentDetail;
		user: UserMe | null;
	} = $props();

	// The sitting these controls act on: the row's own part, or (for a whole-match
	// row) its most recent scheduled sitting. Guaranteed non-null by the caller's
	// rowIsPendingSitting gate, but resolved defensively.
	const part = $derived(rowPart(row));
	const casters = $derived(part?.casters ?? []);
	const mine = $derived(
		user != null && casters.some((c) => c.user_id === user.user_id),
	);
	const isStreamer = $derived(
		user != null && casters[0]?.user_id === user.user_id,
	);

	let busy = $state(false);

	async function cast(role?: "streamer" | "cocaster") {
		if (!part) return;
		const partId = part.id;
		await runAction(
			() =>
				cloudApi.castMatchPart(
					tournament.tournament_id,
					row.match.match_id,
					partId,
					role,
				),
			{
				setBusy: (b) => (busy = b),
				success: role === "streamer" ? "You're the streamer" : "You're casting",
			},
		);
	}
	async function drop() {
		if (!part) return;
		const partId = part.id;
		await runAction(
			() =>
				cloudApi.uncastMatchPart(
					tournament.tournament_id,
					row.match.match_id,
					partId,
				),
			{ setBusy: (b) => (busy = b), success: "Dropped" },
		);
	}
</script>

<!-- Nothing for a logged-out viewer (they still see the "needs a caster" flag in
     the data cell, just no buttons). -->
{#if part && user}
	<div class="flex flex-wrap items-center justify-end gap-1.5">
		<!-- Buttons stopPropagation so acting on a row doesn't also open the match
		     card behind it. -->
		{#if !mine}
			<!-- Empty sitting → you become the streamer ("I'll cast"); a sitting that
			     already has a caster → you join as a co-caster ("Co-cast"). Same
			     endpoint (omitted role picks the slot); the label just tells you which
			     you'll get. -->
			<button
				type="button"
				class="rounded border border-input px-2 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
				disabled={busy}
				onclick={(e) => {
					e.stopPropagation();
					cast();
				}}
			>
				{casters.length === 0 ? "I'll cast" : "Co-cast"}
			</button>
		{:else}
			{#if !isStreamer}
				<button
					type="button"
					class="rounded border border-input px-2 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
					disabled={busy}
					onclick={(e) => {
						e.stopPropagation();
						cast("streamer");
					}}
				>
					Make me streamer
				</button>
			{/if}
			<button
				type="button"
				class="rounded border border-input px-2 py-1 text-xs text-tan/70 transition-colors hover:border-red-400 hover:text-red-400 disabled:opacity-50"
				disabled={busy}
				onclick={(e) => {
					e.stopPropagation();
					drop();
				}}
			>
				Drop
			</button>
		{/if}
	</div>
{/if}
