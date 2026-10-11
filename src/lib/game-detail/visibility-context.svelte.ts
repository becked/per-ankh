// A game's public/private state, shared by all three of its views (the analyst
// view at /games/[id], the map view at /games/[id]/map and the screenshots view
// at /games/[id]/screenshots). The [id] layout constructs one instance and
// provides it via context; each view's GameHeader binds its GameActions lock
// to it.
//
// It lives above the views because the lock is optimistic: the toggle flips
// `isPublic` and saves it, but never refetches (rename and collection moves
// call invalidateAll(); the lock doesn't). A header that owned the state would
// re-seed from the shared load's stale `is_public` after a view switch, and
// show a game the owner just made public as private.
import { getContext, setContext } from "svelte";

export class GameVisibility {
	isPublic = $state(false);

	constructor(initial: boolean) {
		this.isPublic = initial;
	}
}

const KEY = Symbol("game-visibility");

export function setGameVisibility(visibility: GameVisibility): GameVisibility {
	return setContext(KEY, visibility);
}

export function getGameVisibility(): GameVisibility {
	return getContext(KEY);
}
