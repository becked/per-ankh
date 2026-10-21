<script lang="ts">
	import type { MapTile } from "$lib/types/MapTile";
	import { formatEnum, nationName } from "$lib/utils/formatting";
	import { getCivilizationColor } from "$lib/config";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import { improvementDisplayName } from "$lib/game-detail/helpers";
	import { specialistName } from "$lib/game-detail/specialists";
	import { CHROME_PANEL_CLASS } from "$lib/game-detail/map-chrome";

	let {
		tile,
		cityFamily = null,
		civilizationCrestKey = null,
		capture = null,
		screenX,
		screenY,
		canvasWidth,
		canvasHeight,
		onUnlock,
	}: {
		tile: MapTile;
		// Resolved family enum like "FAMILY_PTOLEMY", or null if unknown / not city.
		cityFamily?: string | null;
		// Crest sprite enum for whoever HOLDS this tile's city — a nation or,
		// for a city under capture or a tribe's own, a tribe. "Civilization" is
		// the repo's word for that union (`getCivilizationColor`). Resolved by
		// the parent: a tribe through the baked crest tables, a nation against
		// nation-asset-aliases so variant nations (NATION_AMUN, NATION_ATHENS)
		// fall back to their parent civ's crest (CREST_NATION_EGYPT, ...).
		civilizationCrestKey?: string | null;
		// Who is taking this tile's city, when one is. Null is "not being
		// captured"; a null `nation` inside it is a capture whose captor the
		// blob can't name — a blob from before PARSER_VERSION 2.26.0, or a
		// tribe doing the capturing, which has no nation. The row is omitted
		// for both, because the state already reads from the border.
		capture?: { nation: string | null } | null;
		screenX: number;
		screenY: number;
		// The deck canvas the panel sits over, in CSS pixels — the box it
		// edge-flips inside.
		canvasWidth: number;
		canvasHeight: number;
		// Unlock this tile. Its presence is what makes the panel a LOCKED one:
		// glued to its hex rather than following the pointer, a hit target
		// rather than pointer-transparent, and carrying the ✕ that undoes the
		// lock where the transient panel carries the hint for making one. The
		// hover panel passes nothing.
		onUnlock?: () => void;
	} = $props();

	const locked = $derived(onUnlock != null);

	const nationColor = $derived.by(() => {
		if (!tile.owner_nation) return "rgb(var(--color-tan))";
		return getCivilizationColor(tile.owner_nation) ?? "rgb(var(--color-tan))";
	});

	const cityName = $derived(
		tile.owner_city ? formatEnum(tile.owner_city, "CITYNAME_") : null,
	);

	const headerLabel = $derived.by(() => {
		if (cityName) return cityName;
		if (tile.owner_nation) return nationName(tile.owner_nation);
		return null;
	});

	const terrainLabel = $derived.by(() => {
		if (!tile.terrain) return null;
		// When inside a city, "Urban" duplicates the city header — suppress.
		// The condition is "inside a city", which is what owner_city says: a
		// city nobody holds has no owner_nation on any of its tiles, so those
		// tiles were printing "Urban Hill" under the city's own header.
		if (tile.terrain === "TERRAIN_URBAN" && tile.owner_city) return null;
		const terrain = formatEnum(tile.terrain, "TERRAIN_");
		if (!tile.height) return terrain;
		return `${terrain} ${formatEnum(tile.height, "HEIGHT_")}`;
	});

	const improvementLabel = $derived.by(() => {
		if (!tile.improvement) return null;
		// Shared label (baked name + shrine domain, e.g. "Shrine of Sol (Sun)").
		let imp = improvementDisplayName(tile.improvement);
		if (tile.improvement_pillaged) imp += " (pillaged)";
		return imp;
	});

	// A free specialist from a neighbouring improvement reads the same as a
	// placed one, because in the game it IS the same — `Tile.getSpecialist`
	// (Tile.cs:6993) returns either without distinction, and the row doesn't
	// record which kind it holds.
	const specialistLabel = $derived(
		tile.specialist ? specialistName(tile.specialist) : null,
	);

	// The captor, named only when the blob names one — see `capture` above.
	// In its own nation's colour, which is what the game writes it in
	// (ClientUI.cs:7333 fills the capture bar in
	// `capturePlayer().getPlayerNameColor(...)`); the city NAME above keeps the
	// unowned tan, because nobody owns the city.
	const captorNation = $derived(capture?.nation ?? null);
	const captorColor = $derived(
		(captorNation ? getCivilizationColor(captorNation) : null) ??
			"rgb(var(--color-tan))",
	);

	// Conservative size estimate for edge-flip clamping. Exact CSS size depends on
	// content; over-estimating just biases toward flipping at the canvas edges.
	// The height carries the hint row below the rows as well as the header.
	const ESTIMATED_W = 200;
	const ESTIMATED_H = 130;
	const OFFSET = 12;

	const positionStyle = $derived.by(() => {
		let left = screenX + OFFSET;
		let top = screenY + OFFSET;
		if (canvasWidth > 0 && left + ESTIMATED_W > canvasWidth) {
			left = screenX - OFFSET - ESTIMATED_W;
		}
		if (canvasHeight > 0 && top + ESTIMATED_H > canvasHeight) {
			top = screenY - OFFSET - ESTIMATED_H;
		}
		if (left < 4) left = 4;
		if (top < 4) top = 4;
		return `left: ${left}px; top: ${top}px;`;
	});
</script>

<!-- In the chrome's frame, so the hover panel reads as part of it. A locked
     panel isn't a tooltip — it outlives the pointer and holds a control — so
     it is a labelled group instead. -->
<div
	class="map-tooltip {CHROME_PANEL_CLASS}"
	class:locked
	style={positionStyle}
	role={locked ? "group" : "tooltip"}
	aria-label={locked ? `Locked tile ${tile.x}, ${tile.y}` : undefined}
>
	{#if headerLabel}
		<div class="header">
			<div class="crests">
				{#if civilizationCrestKey}
					<SpriteIcon
						category="crests"
						value={civilizationCrestKey}
						size={18}
					/>
				{/if}
				{#if cityFamily}
					<SpriteIcon category="crests" value={cityFamily} size={18} />
				{/if}
			</div>
			<span class="city-name" style="color: {nationColor};">
				{#if tile.is_capital}<span class="capital-marker">★</span>{/if}
				{headerLabel}
			</span>
		</div>
	{/if}

	<dl class="chrome-rows">
		<dt>Tile</dt>
		<dd>{tile.x}, {tile.y}</dd>
		{#if terrainLabel}
			<dt>Terrain</dt>
			<dd>{terrainLabel}</dd>
		{/if}
		{#if improvementLabel}
			<dt>Improvement</dt>
			<dd>{improvementLabel}</dd>
		{/if}
		{#if specialistLabel}
			<dt>Specialist</dt>
			<dd>{specialistLabel}</dd>
		{/if}
		{#if captorNation}
			<dt>Capturing</dt>
			<dd style="color: {captorColor};">{nationName(captorNation)}</dd>
		{/if}
	</dl>

	<!-- Nothing on the map affords a right-click, so the transient panel says
	     what one does (#256). The locked copy says the reverse, with the ✕ in
	     its corner — last in the markup so it reads after the tile it closes,
	     and lifted out of the flow by `.unlock-btn`. -->
	{#if onUnlock}
		<button
			type="button"
			class="unlock-btn"
			onclick={onUnlock}
			aria-label="Unlock tile {tile.x}, {tile.y}"
			title="Unlock">✕</button
		>
	{:else}
		<p class="lock-hint">Right-click to lock</p>
	{/if}
</div>

<style>
	.map-tooltip {
		position: absolute;
		padding: 8px 10px;
		font-size: 11px;
		line-height: 1.4;
		pointer-events: none;
		z-index: 100;
		min-width: 160px;
		max-width: 240px;
	}

	/* A locked panel is a hit target — it carries the ✕ — and sits between the
	   city banners (z 5) and the chrome (z 10). `.sprite-map-container` is
	   `position: relative` with no `z-index`, so it opens no stacking context
	   and all three compete in one: at the hover panel's 100 a locked panel
	   would park over the chrome's leader panel and swallow its clicks, where
	   here it yields wherever the two overlap and takes clicks everywhere the
	   chrome's `pointer-events-none` root doesn't. */
	.map-tooltip.locked {
		pointer-events: auto;
		z-index: 6;
		/* The gutter the corner ✕ sits in, reserved on the panel rather than
		   on the header: the row under it is the city name on a city tile and
		   the coordinates on every other, so no one child can hold it. */
		padding-right: 22px;
	}
	.header {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 6px;
		padding-bottom: 6px;
		border-bottom: 1px solid rgb(var(--color-border-tooltip));
	}
	.crests {
		display: flex;
		gap: 2px;
		flex-shrink: 0;
	}
	.city-name {
		font-weight: 600;
		font-size: 12px;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-shadow: 0 1px 2px rgb(var(--color-black) / 0.6);
	}
	.capital-marker {
		margin-right: 4px;
		opacity: 0.85;
		font-size: 10px;
	}
	.lock-hint {
		margin: 6px 0 0;
		padding-top: 4px;
		border-top: 1px solid rgb(var(--color-border-tooltip));
		color: rgb(var(--color-muted));
		font-size: 10px;
		font-style: italic;
		text-align: right;
	}
	.unlock-btn {
		position: absolute;
		top: 4px;
		right: 6px;
		color: rgb(var(--color-muted));
		cursor: pointer;
		font-size: 11px;
		line-height: 1;
		padding: 0 2px;
		transition: color 0.15s;
	}
	.unlock-btn:hover {
		color: rgb(var(--color-tan));
	}
	.unlock-btn:focus-visible {
		outline: 2px solid rgb(var(--color-orange));
		outline-offset: 1px;
	}
</style>
