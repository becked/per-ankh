<script lang="ts">
	// "Latest from creators": the newest uploads across every user's linked
	// channels, merged newest-first (GET /v1/creator-videos via the home load).
	// On the home page this is the middle column between the games feed and the
	// right rail on desktop, where it lays out as a 2-up grid of compact
	// (half-size) cards; below `lg` it collapses to a full-width strip (2-up,
	// then 4-up). Each card mirrors RecentSaveCard's discovery header —
	// uploader (top-left) + title + date pill (right) — with the video thumbnail
	// as the media below, so videos read as the same visual family as the game
	// cards beside them. The `class` prop supplies the parent grid's placement
	// (order + col-span).
	import { resolve } from "$app/paths";
	import type { CreatorVideo } from "$lib/api-cloud";
	import { formatRelativeToNow } from "$lib/utils/formatting";

	let {
		videos,
		class: className = "",
	}: { videos: CreatorVideo[]; class?: string } = $props();
</script>

<section class={className}>
	<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-2">
		{#each videos as v (v.platform + ":" + v.id)}
			<div
				class="group relative rounded-lg p-3 transition-colors hover:bg-surface-hover"
				style="background-color: rgb(var(--color-surface-raised));"
			>
				<!-- Stretched-link overlay: the whole card opens the video's external
				     watch URL, but the uploader link below sits above it (higher
				     z-index) so it wins clicks on the name/avatar. href is an
				     http(s) URL, not an app route, so resolve() doesn't apply; rel
				     guards tabnabbing + referrer leakage. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					href={v.url}
					target="_blank"
					rel="noopener noreferrer"
					class="absolute inset-0 z-10 rounded-lg"
					aria-label={v.title}
				></a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->

				<!-- Discovery row: uploader (left) + published date (right), mirroring
				     RecentSaveCard's header. The title gets its own full-width line
				     below so long video titles stay legible in the narrow column. -->
				<div class="mb-2 flex items-center gap-2">
					<a
						href={resolve(`/users/${v.user_id}`)}
						class="relative z-20 flex min-w-0 flex-1 items-center gap-1 hover:underline"
					>
						<img
							src={v.avatar_url}
							alt=""
							class="h-5 w-5 shrink-0 rounded-full"
							width="20"
							height="20"
							loading="lazy"
						/>
						<span class="truncate text-lg font-bold text-white lg:text-sm">
							{v.display_name}
						</span>
					</a>
					<span
						class="shrink-0 rounded bg-amber-700/40 px-1.5 py-0.5 text-xs text-amber-300"
					>
						{formatRelativeToNow(v.published_at)}
					</span>
				</div>

				<div
					class="mb-2 line-clamp-2 text-lg font-bold text-tan group-hover:text-bright lg:text-sm"
				>
					{v.title}
				</div>

				<!-- Media: the video thumbnail, sitting where RecentSaveCard's
				     sparkline does. -->
				{#if v.thumbnail_url}
					<img
						src={v.thumbnail_url}
						alt=""
						loading="lazy"
						class="aspect-video w-full rounded object-cover"
					/>
				{:else}
					<div
						class="aspect-video w-full rounded"
						style="background-color: rgb(var(--color-surface-sunken));"
					></div>
				{/if}
			</div>
		{/each}
	</div>
</section>
