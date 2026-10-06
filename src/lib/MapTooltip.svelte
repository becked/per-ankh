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
		nationCrestKey = null,
		screenX,
		screenY,
		canvasWidth,
		canvasHeight,
	}: {
		tile: MapTile;
		// Resolved family enum like "FAMILY_PTOLEMY", or null if unknown / not city.
		cityFamily?: string | null;
		// Crest sprite enum to render for the nation icon. Resolved by the parent
		// against nation-asset-aliases so variant nations (NATION_AMUN, NATION_ATHENS)
		// fall back to their parent civ's crest (CREST_NATION_EGYPT, ...).
		nationCrestKey?: string | null;
		screenX: number;
		screenY: number;
		// The deck canvas the panel sits over, in CSS pixels — the box it
		// edge-flips inside.
		canvasWidth: number;
		canvasHeight: number;
	} = $props();

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
		if (tile.terrain === "TERRAIN_URBAN" && tile.owner_nation) return null;
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
	// (Tile.cs:6993) returns either without distinction. `specialist_free`
	// records which one the save wrote, not a difference worth showing.
	const specialistLabel = $derived(
		tile.specialist ? specialistName(tile.specialist) : null,
	);

	// Conservative size estimate for edge-flip clamping. Exact CSS size depends on
	// content; over-estimating just biases toward flipping at the canvas edges.
	const ESTIMATED_W = 200;
	const ESTIMATED_H = 110;
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

<!-- In the chrome's frame, so the hover panel reads as part of it. -->
<div
	class="map-tooltip {CHROME_PANEL_CLASS}"
	style={positionStyle}
	role="tooltip"
>
	{#if headerLabel}
		<div class="header">
			<div class="crests">
				{#if nationCrestKey}
					<SpriteIcon category="crests" value={nationCrestKey} size={18} />
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
	</dl>
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
</style>
