<script lang="ts">
	// A single video rendered in the discovery-card style shared by the home
	// creator feed (CreatorVideos) and a profile's Videos tab (VideosTab). Mirrors
	// RecentSaveCard's header so videos read as the same visual family as the game
	// cards: an attribution/date row on top, the title on its own line, then the
	// thumbnail as the media below. The whole card is a stretched link out to the
	// video's external watch URL.
	//
	// A CreatorVideo bundles the uploader, so the header carries an avatar + name
	// linking to their profile. A surface where that credit would be redundant —
	// a profile's own Videos tab, where every video is that one user's — passes
	// showUploader={false} and gets the date pill alone. The video still carries
	// its uploader there, which is what lets the admin star below snapshot who
	// uploaded it.
	import { page } from "$app/state";
	import type {
		CreatorVideo,
		RecentVideo,
		YouTubeAttributedVideo,
	} from "$lib/api-cloud";
	import { isFeatured, setFeatured } from "$lib/featured-videos.svelte";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import { formatRelativeToNow } from "$lib/utils/formatting";

	let {
		video,
		showUploader = true,
	}: {
		video: RecentVideo | CreatorVideo | YouTubeAttributedVideo;
		showUploader?: boolean;
	} = $props();

	// A linked Per-Ankh user (home feed + matched tournament uploads): avatar +
	// display name linking to their profile.
	const uploader = $derived("user_id" in video ? video : null);
	// An unlinked YouTube uploader (tournament playlist only): channel name
	// linking out to the channel, no avatar. Only when there's no Per-Ankh user.
	const ytUploader = $derived(
		"user_id" in video ? null : "uploader_name" in video ? video : null,
	);

	// Site-admin only: the star that adds this video to (or removes it from) the
	// featured set. Read from `page` here rather than threaded down as a prop —
	// every surface renders this card from a list, and none of them has any
	// other reason to know who's looking (the same reason GameActions,
	// BulkUploadModal and SettingsPopover read it directly).
	const canFeature = $derived(page.data.user?.is_admin === true);
	const featured = $derived(isFeatured(video));
	let saving = $state(false);

	async function toggleFeatured() {
		if (saving) return;
		saving = true;
		// Optimistic — the shared set flips first and reverts itself on failure.
		await setFeatured(video, !featured);
		saving = false;
	}
</script>

<!-- `group` is what reveals the admin star below on hover. -->
<div
	class="group relative rounded-lg p-3 transition duration-150 hover:-translate-y-0.5 hover:shadow-lg"
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

	<!-- Discovery row: uploader (left, where the surface credits one) + published
	     date (right), mirroring RecentSaveCard's header. The date pill uses
	     ml-auto so it stays right-aligned even when the uploader is absent. -->
	<div class="mb-2 flex items-center gap-2">
		{#if showUploader && uploader}
			<ProfileLink
				userId={uploader.user_id}
				slug={uploader.slug}
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
			</ProfileLink>
		{:else if showUploader && ytUploader}
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
			{formatRelativeToNow(video.published_at, "local")}
		</span>
		{#if canFeature}
			<!-- Above the stretched-link overlay (z-20, the escape hatch the
			     uploader link uses) so it wins the click instead of opening the
			     video. Hidden until the card is hovered or the button itself is
			     focused, and inert while hidden so an invisible star can't be
			     clicked; that means no control on touch, which the Featured tab on
			     /admin covers. Filled = featured. -->
			<button
				type="button"
				onclick={toggleFeatured}
				disabled={saving}
				aria-pressed={featured}
				aria-label={featured ? "Remove from featured" : "Feature this video"}
				title={featured ? "Remove from featured" : "Feature this video"}
				class="pointer-events-none relative z-20 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-tan-hover focus-visible:pointer-events-auto focus-visible:opacity-100 disabled:opacity-50 group-hover:pointer-events-auto group-hover:opacity-100 {featured
					? 'text-orange'
					: 'text-tan'}"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					viewBox="0 0 24 24"
					fill={featured ? "currentColor" : "none"}
					stroke="currentColor"
					stroke-width="1.5"
					aria-hidden="true"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"
					/>
				</svg>
			</button>
		{/if}
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
