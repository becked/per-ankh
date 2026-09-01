// Old World's hex grid, shared by everything that has to ask "what is next to
// this tile?" — the map's border tracing and the Techs tab's adjacency
// science. The offset convention is parity-dependent, so a second
// hand-rolled copy would be silently wrong on half the rows.

/**
 * The six tiles adjacent to (x, y), pointy-top even-r — the same offsets the
 * game uses (`Utils.DIRECTION_OFFSET_X_EVEN` / `_ODD` + `_Y`, indexed by
 * `DirectionType`). `SpriteMap`'s `hexToPixel` shifts even rows right by half
 * a spacing, so even and odd rows have different diagonal neighbours.
 *
 * Returned in the order **[NE, E, SE, SW, W, NW]** to match `hexPolygon`'s
 * edge index — edge i connects vertex i to vertex i+1 and faces neighbour i.
 * Callers that only ask "is X beside me?" can ignore the order. Note
 * `hexToPixel` negates Y, so game y+1 renders as "north" (top of screen).
 *
 * Coordinates may fall outside the map; the game's `Game.tileGrid` bounds-
 * checks and returns nothing rather than wrapping, so a caller looking tiles
 * up by (x, y) gets the same answer by simply missing.
 */
export function hexNeighbors(x: number, y: number): [number, number][] {
	if (y % 2 === 0) {
		return [
			[x + 1, y + 1], // NE
			[x + 1, y], // E
			[x + 1, y - 1], // SE
			[x, y - 1], // SW
			[x - 1, y], // W
			[x, y + 1], // NW
		];
	}
	return [
		[x, y + 1], // NE
		[x + 1, y], // E
		[x, y - 1], // SE
		[x - 1, y - 1], // SW
		[x - 1, y], // W
		[x - 1, y + 1], // NW
	];
}
