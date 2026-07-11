<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import {
		ApiError,
		cloudApi,
		type PatchTournamentBody,
		type TournamentDetail,
		type TournamentLink,
	} from "$lib/api-cloud";
	import { toast } from "$lib/ui/toast";

	interface Props {
		tournament: TournamentDetail;
		// When false the editor renders read-only (inputs disabled, no add/remove).
		// Mirrors TournamentSettingsForm — non-admins can see settings but not edit.
		canEdit?: boolean;
	}

	let { tournament, canEdit = true }: Props = $props();

	// Stable per-row key so the keyed #each survives add/remove without rebinding
	// inputs to the wrong row.
	let nextKey = 0;
	interface Row {
		key: number;
		label: string;
		url: string;
	}

	// Local edit state, seeded once from props. The on-page overview panel doesn't
	// remount, so keeping incomplete rows here (rather than re-deriving from props)
	// lets a half-typed row survive a sibling field's commit. Each commit calls
	// invalidateAll(); the settings-popover instance remounts on open and re-seeds.
	// svelte-ignore state_referenced_locally
	let rows = $state<Row[]>(
		tournament.links.map((l) => ({
			key: nextKey++,
			label: l.label,
			url: l.url,
		})),
	);

	// Prepend https:// when the user omits a scheme (so "old-world-map-pics.com"
	// works). Anything already carrying a scheme is left for the server to vet.
	function normalizeUrl(raw: string): string {
		const trimmed = raw.trim();
		if (!trimmed) return "";
		return /:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
	}

	// The payload: complete rows only (both fields filled), normalized. Incomplete
	// rows stay in local state, uncommitted, so a half-typed link isn't dropped.
	function buildLinks(): TournamentLink[] {
		return rows
			.map((r) => ({ label: r.label.trim(), url: normalizeUrl(r.url) }))
			.filter((l) => l.label !== "" && l.url !== "");
	}

	function sameAsServer(next: TournamentLink[]): boolean {
		const cur = tournament.links;
		if (cur.length !== next.length) return false;
		return next.every(
			(l, i) => l.label === cur[i].label && l.url === cur[i].url,
		);
	}

	async function savePatch(body: PatchTournamentBody) {
		try {
			await cloudApi.patchTournament(tournament.tournament_id, body);
			await invalidateAll();
			toast.info("Saved");
		} catch (err) {
			let message = "Save failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			toast.error(message);
		}
	}

	async function commit() {
		if (!canEdit) return;
		const next = buildLinks();
		if (sameAsServer(next)) return;
		await savePatch({ links: next });
	}

	function commitUrl(row: Row) {
		// Reflect the normalized form back into the input so what's shown matches
		// what was saved.
		row.url = normalizeUrl(row.url);
		commit();
	}

	function addRow() {
		rows.push({ key: nextKey++, label: "", url: "" });
	}

	function removeRow(i: number) {
		rows.splice(i, 1);
		commit();
	}

	// The tournament's YouTube playlist — kept in this section (it's a kind of
	// link) but PATCHed as its own scalar; its uploads feed the Videos tab.
	// svelte-ignore state_referenced_locally
	let youtubePlaylistUrl = $state(tournament.youtube_playlist_url ?? "");

	// Empty → null clears the playlist (which hides the Videos tab). The server
	// validates the URL; on rejection savePatch toasts the error and
	// invalidateAll() restores the stored value.
	function commitYoutubePlaylistUrl() {
		if (!canEdit) return;
		const next = youtubePlaylistUrl.trim() || null;
		if (next === tournament.youtube_playlist_url) return;
		savePatch({ youtube_playlist_url: next });
	}

	function clearYoutubePlaylistUrl() {
		youtubePlaylistUrl = "";
		commitYoutubePlaylistUrl();
	}
</script>

{#if canEdit || rows.length > 0 || tournament.youtube_playlist_url}
	<div class="flex flex-col gap-2">
		<span class="text-sm font-bold text-tan">Tournament Links</span>
		{#if rows.length > 0}
			<div class="flex items-center gap-2 text-xs text-tan opacity-70">
				<span class="w-28 flex-none">Name</span>
				<span class="flex-1">URL</span>
			</div>
		{/if}
		{#each rows as row, i (row.key)}
			<div class="flex items-center gap-2">
				<input
					type="text"
					bind:value={row.label}
					onblur={commit}
					disabled={!canEdit}
					class="w-28 flex-none rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none disabled:opacity-50"
				/>
				<input
					type="url"
					bind:value={row.url}
					onblur={() => commitUrl(row)}
					disabled={!canEdit}
					class="min-w-0 flex-1 rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none disabled:opacity-50"
				/>
				{#if canEdit}
					<button
						type="button"
						class="rounded px-1.5 leading-none text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
						onclick={() => removeRow(i)}
						aria-label="Remove link"
						title="Remove link"
					>
						✕
					</button>
				{/if}
			</div>
		{/each}
		{#if canEdit}
			<button
				type="button"
				class="self-start rounded border border-tan px-2.5 py-1 text-xs text-tan opacity-80 transition-opacity hover:opacity-100"
				onclick={addRow}
			>
				Add link
			</button>
		{/if}

		{#if canEdit || tournament.youtube_playlist_url}
			<div class="mt-1 flex flex-col gap-1">
				<span class="text-xs text-tan opacity-70">YouTube playlist</span>
				<div class="flex items-center gap-2">
					<input
						type="url"
						bind:value={youtubePlaylistUrl}
						onblur={commitYoutubePlaylistUrl}
						disabled={!canEdit}
						class="min-w-0 flex-1 rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none disabled:opacity-50"
					/>
					{#if canEdit && youtubePlaylistUrl}
						<button
							type="button"
							class="rounded px-1.5 leading-none text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
							onclick={clearYoutubePlaylistUrl}
							aria-label="Clear playlist"
							title="Clear playlist"
						>
							✕
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}
