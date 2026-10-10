<script lang="ts">
	// Spans all three views of a game (analysis, map and screenshots) so the
	// state they share survives a switch between them: the owner's visibility
	// toggle (see visibility-context) and the game's screenshots (see
	// screenshots-context). Each page renders its own header; this layout
	// renders only its children.
	import { untrack, type Snippet } from "svelte";
	import {
		GameScreenshots,
		setGameScreenshots,
	} from "$lib/game-detail/screenshots-context.svelte";
	import {
		GameVisibility,
		setGameVisibility,
	} from "$lib/game-detail/visibility-context.svelte";
	import type { LayoutData } from "./$types";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// Read from the server-injected `is_public` field on owner responses.
	// Initialised at component construction (not in $effect) so the SSR'd HTML
	// renders the correct toggle position; $effect doesn't run during SSR.
	// Public viewers don't see the toggle.
	// svelte-ignore state_referenced_locally
	const visibility = setGameVisibility(
		new GameVisibility(data.game.is_public ?? false),
	);

	// The screenshots, on the same terms: constructed here so the SSR'd HTML
	// carries the strip and the Screenshots segment, rather than both arriving
	// on hydration.
	// svelte-ignore state_referenced_locally
	const screenshots = setGameScreenshots(new GameScreenshots(data.screenshots));

	// Re-sync when the route navigates to a different game. Only the match id
	// is tracked; the body reads via untrack(). This avoids clobbering an
	// in-flight optimistic write if the layout is revalidated for the same game
	// (e.g. invalidateAll() from a rename): the new server `is_public` would
	// race the lock's optimistic flip, and the reloaded list would race a
	// screenshot delete still in flight and put its tile back.
	$effect(() => {
		data.game.game_details.match_id;
		untrack(() => {
			visibility.isPublic = data.game.is_public ?? false;
			screenshots.list = data.screenshots;
		});
	});
</script>

{@render children()}
