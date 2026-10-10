<script lang="ts">
	// The home page's curated screenshot strip (issue #289, step 7): the
	// admin-starred set, newest star first. Nothing else reaches the home page —
	// the star is an admin decision taken in the moderation queue, and this is
	// the only screenshot surface a visitor meets without navigating to a game
	// or a profile, which is why it is the one where a miss shows.
	//
	// Deliberately NOT ScreenshotGallery, which is the grid the game-detail
	// strip and the profile tab share. Those two are surfaces you arrive at,
	// where a tile's job is to open the image and to carry the owner's delete or
	// a viewer's report. Here a tile's job is to send someone into the game it
	// came from, so it is a discovery card — the stance RecentSaveCard and
	// VideoCard take in the row below this one — and the report control stays
	// where the image is actually being examined, one click away on the game's
	// own strip.
	//
	// Tiles render the Worker's thumbnail URL, the single Cloudflare Images
	// transformation of the stored object; there is exactly one size, which is a
	// billing constraint rather than a preference ($lib/screenshots/public-urls),
	// so this grid is sized to that tile and not the other way round. The 8:5
	// box is the transformation's own shape, so the box the grid reserves is the
	// box the image fills and no row resizes as tiles arrive.
	import { resolve } from "$app/paths";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import { formatGameTitle } from "$lib/utils/formatting";
	import type { FeaturedScreenshot } from "$lib/api-cloud";

	let { screenshots }: { screenshots: FeaturedScreenshot[] } = $props();

	// The raw title fields, formatted where every other surface formats them.
	// match_id: 0 is only consulted when name, nation and turns are all missing
	// — the shape ScreenshotGallery and RecentSaveCard both pass.
	function gameTitle(shot: FeaturedScreenshot): string {
		return formatGameTitle({
			display_name: shot.game.display_name,
			game_name: shot.game.game_name,
			save_owner_nation: shot.game.user_nation,
			total_turns: shot.game.total_turns,
			match_id: 0,
		});
	}
</script>

<!--
Six across at `lg`, which is the strip's own cap (MAX_FEATURED_SCREENSHOTS):
2 / 3 / 6 all divide six, so no width leaves an orphan tile.
-->
<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
	{#each screenshots as shot (shot.screenshot_id)}
		<figure class="group relative min-w-0">
			<!--
      Stretched link over the whole tile, into the game the screenshot is of.
      The uploader's link in the caption sits above it (higher z-index) so it
      wins clicks on the avatar and the name, the pattern VideoCard uses.
      -->
			<a
				href={resolve("/games/[id]", { id: shot.game_id })}
				class="absolute inset-0 z-10 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange"
				aria-label={gameTitle(shot)}
			></a>
			<div class="relative overflow-hidden rounded bg-surface-deep">
				<img
					src={shot.thumb_url}
					alt={shot.caption ?? "Game screenshot"}
					width="640"
					height="400"
					loading="lazy"
					class="aspect-[8/5] w-full object-cover transition group-hover:opacity-90"
				/>
				{#if shot.caption}
					<!-- The uploader's own words, over the image rather than under it:
               a caption only some tiles carry would otherwise make the row
               ragged, and the overlay costs no layout height. -->
					<span
						class="absolute inset-x-0 bottom-0 block truncate bg-black/70 px-1.5 py-0.5 text-xs text-tan"
						title={shot.caption}>{shot.caption}</span
					>
				{/if}
			</div>
			<!-- Two lines, always both, so the strip's tiles stay the same height:
           who took it, then which game it is of. The game is plain text — the
           tile already links there. -->
			<figcaption class="mt-1 min-w-0 text-xs">
				<ProfileLink
					userId={shot.uploader.user_id}
					slug={shot.uploader.slug}
					class="relative z-20 flex min-w-0 items-center gap-1 hover:underline"
				>
					<img
						src={shot.uploader.avatar_url}
						alt=""
						class="h-4 w-4 shrink-0 rounded-full"
						width="16"
						height="16"
						loading="lazy"
					/>
					<span class="truncate text-tan">{shot.uploader.display_name}</span>
				</ProfileLink>
				<p class="truncate text-gray-400">{gameTitle(shot)}</p>
			</figcaption>
		</figure>
	{/each}
</div>
