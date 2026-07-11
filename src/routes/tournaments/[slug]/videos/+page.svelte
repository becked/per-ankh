<script lang="ts">
	// Tournament Videos view: the uploads from the admin-set YouTube playlist,
	// newest first, rendered as the same discovery-style VideoCards the home
	// creator feed and the profile Videos tab use — so the three surfaces read as
	// one family. Data comes from the page load (the whole playlist, so search can
	// reach every video, not just the ones on screen). The grid shows a capped
	// first page and reveals more on demand; an always-visible search box, in its
	// own matching panel above the grid, filters the full list by video title or
	// creator name. The tab linking here is hidden unless a playlist is set; a
	// direct visit to an unconfigured tournament shows the empty state. The grid
	// sits in a recessed panel so the raised cards read as a well, matching
	// VideosTab.
	import SearchInput from "$lib/SearchInput.svelte";
	import VideoCard from "$lib/VideoCard.svelte";
	import type { TournamentVideo } from "$lib/api-cloud";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// Cards shown before "Show more" reveals the next batch — fills the 3-column
	// grid to four clean rows. Search filters the full list; this only bounds how
	// many of the (filtered) results the grid renders at once.
	const PAGE_SIZE = 12;

	let query = $state("");
	let shown = $state(PAGE_SIZE);

	// The name a search term matches against: a linked Per-Ankh user carries
	// display_name, an unlinked YouTube channel uploader_name — the same
	// discrimination VideoCard uses to attribute a card — so search covers either
	// kind of uploader (and plain, unattributed videos match on title alone).
	function creatorName(v: TournamentVideo): string {
		if ("display_name" in v) return v.display_name;
		if ("uploader_name" in v) return v.uploader_name;
		return "";
	}

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return data.videos;
		return data.videos.filter(
			(v) =>
				v.title.toLowerCase().includes(q) ||
				creatorName(v).toLowerCase().includes(q),
		);
	});

	const visible = $derived(filtered.slice(0, shown));
</script>

{#if data.videos.length > 0}
	<div
		class="mb-3 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface-sunken));"
	>
		<SearchInput
			bind:value={query}
			variant="dark"
			placeholder=""
			class="w-72"
		/>
	</div>
{/if}

<div
	class="rounded-lg p-4"
	style="background-color: rgb(var(--color-surface-sunken));"
>
	{#if data.videos.length === 0}
		<div class="py-8 text-center text-sm text-gray-400">No videos yet.</div>
	{:else if filtered.length === 0}
		<div class="py-8 text-center text-sm text-gray-400">
			No videos match your search.
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each visible as v (v.platform + ":" + v.id)}
				<VideoCard video={v} />
			{/each}
		</div>
		{#if filtered.length > shown}
			<div class="mt-4 flex justify-center">
				<button
					type="button"
					onclick={() => (shown += PAGE_SIZE)}
					class="rounded-lg border-2 border-surface px-4 py-2 text-sm text-tan transition-colors hover:bg-surface-hover hover:text-orange"
				>
					Show more
				</button>
			</div>
		{/if}
	{/if}
</div>
