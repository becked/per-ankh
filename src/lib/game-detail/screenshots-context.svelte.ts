// A game's screenshots, shared by all three of its views (the analyst view at
// /games/[id], the map view at /games/[id]/map and the screenshots view at
// /games/[id]/screenshots). The [id] layout constructs one instance from its
// load and provides it via context; the header reads it to decide whether to
// offer the Screenshots segment at all, the camera in GameActions prepends an
// accepted upload to it, and the screenshots view renders it.
//
// It lives above the views for the same reason GameVisibility does, and then
// for one more: both ends of it are optimistic. An upload prepends a tile and a
// delete removes one without refetching, so a view that owned the list would
// re-seed from the shared load on every switch — and the segment the header
// offers has to appear the moment the upload lands, on whichever view the
// owner pressed the camera from.
import { getContext, setContext } from "svelte";
import type { GameScreenshot } from "$lib/api-cloud";

export class GameScreenshots {
	list = $state<GameScreenshot[]>([]);

	constructor(initial: GameScreenshot[]) {
		this.list = initial;
	}
}

const KEY = Symbol("game-screenshots");

export function setGameScreenshots(
	screenshots: GameScreenshots,
): GameScreenshots {
	return setContext(KEY, screenshots);
}

export function getGameScreenshots(): GameScreenshots {
	return getContext(KEY);
}
