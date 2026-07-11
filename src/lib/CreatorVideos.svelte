<script lang="ts">
	// "Latest from creators": the newest uploads across every user's linked
	// channels, merged newest-first (GET /v1/creator-videos via the home load).
	// A full-width strip on the home page, shown to signed-in and signed-out
	// viewers alike. Each card links out to the video; the footer links to the
	// uploader's profile. Card styling mirrors the profile VideosTab grid.
	import { resolve } from "$app/paths";
	import type { CreatorVideo } from "$lib/api-cloud";
	import { formatRelativeToNow } from "$lib/utils/formatting";

	let { videos }: { videos: CreatorVideo[] } = $props();
</script>

<section class="mb-4">
	<h2 class="mb-3 text-lg font-bold text-gray-200">Latest from creators</h2>
	<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
		{#each videos as v (v.platform + ":" + v.id)}
			<div
				class="group flex flex-col overflow-hidden rounded-lg"
				style="background-color: rgb(var(--color-surface));"
			>
				<!-- href is the platform's external watch URL (http(s)), not an app
				     route, so resolve() doesn't apply; rel guards tabnabbing +
				     referrer leakage. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a href={v.url} target="_blank" rel="noopener noreferrer" class="block">
					{#if v.thumbnail_url}
						<img
							src={v.thumbnail_url}
							alt=""
							loading="lazy"
							class="aspect-video w-full object-cover"
						/>
					{:else}
						<div
							class="aspect-video w-full"
							style="background-color: rgb(var(--color-surface-sunken));"
						></div>
					{/if}
					<div class="px-3 pb-1.5 pt-2.5">
						<div
							class="line-clamp-2 text-sm font-bold text-tan group-hover:text-bright"
						>
							{v.title}
						</div>
					</div>
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
				<a
					href={resolve(`/users/${v.user_id}`)}
					class="mt-auto flex items-center gap-1.5 px-3 pb-3 text-xs text-gray-400 transition-colors hover:text-orange"
				>
					<img
						src={v.avatar_url}
						alt=""
						class="h-5 w-5 shrink-0 rounded-full"
						width="20"
						height="20"
					/>
					<span class="min-w-0 flex-1 truncate font-semibold">
						{v.display_name}
					</span>
					<span aria-hidden="true">·</span>
					<span class="shrink-0">{formatRelativeToNow(v.published_at)}</span>
				</a>
			</div>
		{/each}
	</div>
</section>
