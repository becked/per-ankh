<script lang="ts">
	// Recent videos merged across the user's linked channels (newest first),
	// rendered as a thumbnail grid. Each card links out to the video on its
	// platform. Data comes from GET /v1/users/:id/videos via the page load.
	import type { RecentVideo } from "$lib/api-cloud";
	import { formatDate, platformLabel } from "$lib/utils/formatting";

	let { videos }: { videos: RecentVideo[] } = $props();
</script>

{#if videos.length === 0}
	<div class="py-8 text-center text-sm text-gray-400">No recent videos.</div>
{:else}
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
		<!-- href is the platform's external watch URL (http(s)), not an app
		     route, so resolve() doesn't apply; rel="noopener noreferrer" guards
		     against tabnabbing + referrer leakage. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		{#each videos as v (v.platform + ":" + v.id)}
			<a
				href={v.url}
				target="_blank"
				rel="noopener noreferrer"
				class="group block overflow-hidden rounded-lg transition-colors"
				style="background-color: rgb(var(--color-surface));"
			>
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
				<div class="p-3">
					<div
						class="line-clamp-2 text-sm font-bold text-tan group-hover:text-bright"
					>
						{v.title}
					</div>
					<div class="mt-1 flex items-center gap-1.5 text-xs text-gray-400">
						<span>{platformLabel(v.platform)}</span>
						<span aria-hidden="true">·</span>
						<span>{formatDate(v.published_at)}</span>
					</div>
				</div>
			</a>
		{/each}
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>
{/if}
