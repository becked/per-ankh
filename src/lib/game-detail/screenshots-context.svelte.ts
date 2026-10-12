// A game's screenshots, shared by all three of its views (the analyst view at
// /games/[id], the map view at /games/[id]/map and the screenshots view at
// /games/[id]/screenshots). The [id] layout constructs one instance from its
// load and provides it via context; the header reads it to decide whether to
// offer the Screenshots segment to a visitor, both cameras prepend an accepted
// upload to it (see `prepend`), and the screenshots view renders it.
//
// It lives above the views for the same reason GameVisibility does, and then
// for one more: both ends of it are optimistic. An upload prepends a tile and a
// delete removes one without refetching, so a view that owned the list would
// re-seed from the shared load on every switch — and the segment the header
// offers has to appear the moment the upload lands, on whichever view the
// owner pressed the camera from.
import { getContext, setContext } from "svelte";
import type { GameScreenshot, UploadedScreenshot } from "$lib/api-cloud";

export class GameScreenshots {
	list = $state<GameScreenshot[]>([]);

	constructor(initial: GameScreenshot[]) {
		this.list = initial;
	}

	// The one writer of an accepted upload, because there are two cameras: the
	// one in the game header and the one the screenshots view offers when it is
	// empty. `featured` is the field the 201 doesn't carry — a screenshot a
	// moment old has never been starred, and the gallery's admin star reads it
	// — so the normalisation lives with the state it guards rather than once
	// per camera.
	prepend(shot: UploadedScreenshot): void {
		this.list = [{ ...shot, featured: false }, ...this.list];
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
