<script lang="ts">
	// A single video rendered in the discovery-card style shared by the home
	// creator feed (CreatorVideos) and a profile's Videos tab (VideosTab). Mirrors
	// RecentSaveCard's header so videos read as the same visual family as the game
	// cards: an attribution/date row on top, the title on its own line, then the
	// thumbnail as the media below. The whole card is a stretched link out to the
	// video's external watch URL.
	//
	// A CreatorVideo (the cross-creator home feed) bundles the uploader, so the
	// header carries an avatar + name linking to their profile. A plain
	// RecentVideo (a single profile's tab) has no uploader — every video is that
	// one user's, so attribution would be redundant — and only the date pill shows.
	import { resolve } from "$app/paths";
	import type {
		CreatorVideo,
		RecentVideo,
		YouTubeAttributedVideo,
	} from "$lib/api-cloud";
	import { formatRelativeToNow } from "$lib/utils/formatting";

	let {
		video,
	}: { video: RecentVideo | CreatorVideo | YouTubeAttributedVideo } = $props();

	// A linked Per-Ankh user (home feed + matched tournament uploads): avatar +
	// display name linking to their profile.
	const uploader = $derived("user_id" in video ? video : null);
	// An unlinked YouTube uploader (tournament playlist only): channel name
	// linking out to the channel, no avatar. Only when there's no Per-Ankh user.
	const ytUploader = $derived(
		"user_id" in video ? null : "uploader_name" in video ? video : null,
	);
</script>

<div
	class="relative rounded-lg p-3 transition duration-150 hover:-translate-y-0.5 hover:shadow-lg"
	style="background-color: rgb(var(--color-surface-raised));"
>
	<!-- Stretched-link overlay: the whole card opens the video's external watch
	     URL, but the uploader link below sits above it (higher z-index) so it wins
	     clicks on the name/avatar. href is an http(s) URL, not an app route, so
	     resolve() doesn't apply; rel guards tabnabbing + referrer leakage. -->
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<a
		href={video.url}
		target="_blank"
		rel="noopener noreferrer"
		class="absolute inset-0 z-10 rounded-lg"
		aria-label={video.title}
	></a>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->

	<!-- Discovery row: uploader (left, cross-creator feed only) + published date
	     (right), mirroring RecentSaveCard's header. The date pill uses ml-auto so
	     it stays right-aligned even when the uploader is absent. -->
	<div class="mb-2 flex items-center gap-2">
		{#if uploader}
			<a
				href={resolve(`/users/${uploader.user_id}`)}
				class="relative z-20 flex min-w-0 flex-1 items-center gap-1 hover:underline"
			>
				<img
					src={uploader.avatar_url}
					alt=""
					class="h-5 w-5 shrink-0 rounded-full"
					width="20"
					height="20"
					loading="lazy"
				/>
				<span class="truncate text-lg font-bold text-white lg:text-sm">
					{uploader.display_name}
				</span>
			</a>
		{:else if ytUploader}
			<!-- Unlinked YouTube uploader: name links out to the channel (external URL,
			     not an app route), sitting above the card's stretched link. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a
				href={ytUploader.uploader_url}
				target="_blank"
				rel="noopener noreferrer"
				class="relative z-20 flex min-w-0 flex-1 items-center gap-1 hover:underline"
			>
				<span class="truncate text-lg font-bold text-white lg:text-sm">
					{ytUploader.uploader_name}
				</span>
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
		<span
			class="ml-auto shrink-0 rounded bg-amber-700/40 px-1.5 py-0.5 text-xs text-amber-300"
		>
			{formatRelativeToNow(video.published_at)}
		</span>
	</div>

	<div class="mb-2 line-clamp-2 text-lg font-bold text-tan lg:text-sm">
		{video.title}
	</div>

	<!-- Media: the video thumbnail, sitting where RecentSaveCard's sparkline does. -->
	{#if video.thumbnail_url}
		<img
			src={video.thumbnail_url}
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
