<script lang="ts">
	// Inline caster self-service buttons for one match sitting, hosted in the
	// shared match table's trailing actions column (MatchTable). Any logged-in
	// user can add themselves as the streamer or a co-caster, or drop. Writes go
	// through the self-service cast endpoints (a caster only ever touches their
	// own entry) and refresh via invalidateAll. Rendered on every match surface
	// for pending scheduled sittings — the caller gates on rowIsPendingSitting.
	// The "needs a caster" flag is not here; it lives with the caster/stream data
	// in the Casters & Streams cell.
	//
	// Streamer casts auto-attach the caster's stream link (users.stream_url,
	// editable in account preferences). A first-time streamer with no stored
	// link gets a one-time inline input — whatever they enter is remembered
	// server-side, so every later cast is again a single click.
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
	// An empty sitting makes the caller the streamer — the only case where a
	// stream link matters (co-casts air on the streamer's channel).
	const wouldStream = $derived(casters.length === 0);

	let busy = $state(false);
	// One-time stream-link input, shown when a would-be streamer has no stored
	// link yet.
	let promptOpen = $state(false);
	let streamUrl = $state("");

	async function cast() {
		if (!part) return;
		const partId = part.id;
		// The URL field is a bare-domain magnet ("youtube.com/@sion/live"); the
		// API requires a scheme, so add one rather than bounce the cast on a 400.
		const trimmed = streamUrl.trim();
		const withUrl =
			trimmed === ""
				? undefined
				: /^https?:\/\//i.test(trimmed)
					? trimmed
					: `https://${trimmed}`;
		const ok = await runAction(
			() =>
				cloudApi.castMatchPart(
					tournament.tournament_id,
					row.match.match_id,
					partId,
					undefined,
					withUrl,
				),
			{ setBusy: (b) => (busy = b), success: "You're casting" },
		);
		if (ok !== null) {
			promptOpen = false;
			streamUrl = "";
		}
	}

	function onCastClick() {
		// First streamer cast with no remembered link: unfold the one-time
		// stream input instead of casting streamless right away.
		if (wouldStream && user?.stream_url == null && !promptOpen) {
			promptOpen = true;
			return;
		}
		cast();
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
			{#if promptOpen}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="flex items-center gap-1.5"
					onclick={(e) => e.stopPropagation()}
					onkeydown={(e) => e.stopPropagation()}
				>
					<!-- Autofocus is fine here: the field only appears in response to the
					     user's own click, so focus follows their intent. -->
					<!-- svelte-ignore a11y_autofocus -->
					<input
						type="text"
						class="w-40 rounded border border-input bg-surface-sunken px-2 py-1 text-xs text-tan placeholder:text-gray-500 focus:border-orange focus:outline-none"
						placeholder="youtube.com/@you/live (optional)"
						title="Your stream link — remembered for future casts. Leave empty to cast without one."
						bind:value={streamUrl}
						disabled={busy}
						autofocus
						onkeydown={(e) => {
							if (e.key === "Enter") cast();
							if (e.key === "Escape") promptOpen = false;
						}}
					/>
					<button
						type="button"
						class="rounded border border-input px-2 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
						disabled={busy}
						onclick={cast}
					>
						Cast
					</button>
				</div>
			{:else}
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
						onCastClick();
					}}
				>
					{wouldStream ? "I'll cast" : "Co-cast"}
				</button>
			{/if}
		{:else}
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
