<script lang="ts">
	import type { MapTile } from "$lib/types/MapTile";
	import { formatEnum } from "$lib/utils/formatting";
	import { getCivilizationColor } from "$lib/config";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";

	let {
		tile,
		cityFamily = null,
		nationCrestKey = null,
		pinned = false,
		screenX,
		screenY,
		containerWidth,
		containerHeight,
		onClose,
	}: {
		tile: MapTile;
		// Resolved family enum like "FAMILY_PTOLEMY", or null if unknown / not city.
		cityFamily?: string | null;
		// Crest sprite enum to render for the nation icon. Resolved by the parent
		// against nation-asset-aliases so variant nations (NATION_AMUN, NATION_ATHENS)
		// fall back to their parent civ's crest (CREST_NATION_EGYPT, ...).
		nationCrestKey?: string | null;
		pinned?: boolean;
		screenX: number;
		screenY: number;
		containerWidth: number;
		containerHeight: number;
		onClose?: () => void;
	} = $props();

	const nationColor = $derived.by(() => {
		if (!tile.owner_nation) return "var(--color-tan)";
		return (
			getCivilizationColor(tile.owner_nation.replace("NATION_", "")) ??
			"var(--color-tan)"
		);
	});

	const cityName = $derived(
		tile.owner_city ? formatEnum(tile.owner_city, "CITYNAME_") : null,
	);

	const headerLabel = $derived.by(() => {
		if (cityName) return cityName;
		if (tile.owner_nation) return formatEnum(tile.owner_nation, "NATION_");
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
		let imp = formatEnum(tile.improvement, "IMPROVEMENT_");
		// Rebrand shrines and monasteries so the deity reads first (e.g. "Sun Shrine").
		if (imp.startsWith("Shrine ")) imp = imp.replace("Shrine ", "") + " Shrine";
		else if (imp.startsWith("Monastery "))
			imp = imp.replace("Monastery ", "") + " Monastery";
		if (tile.improvement_pillaged) imp += " (pillaged)";
		return imp;
	});

	const specialistLabel = $derived(
		tile.specialist ? formatEnum(tile.specialist, "SPECIALIST_") : null,
	);

	// Conservative size estimate for edge-flip clamping. Exact CSS size depends on
	// content; over-estimating just biases toward flipping at container edges.
	const ESTIMATED_W = 200;
	const ESTIMATED_H = 110;
	const OFFSET = 12;

	const positionStyle = $derived.by(() => {
		let left = screenX + OFFSET;
		let top = screenY + OFFSET;
		if (containerWidth > 0 && left + ESTIMATED_W > containerWidth) {
			left = screenX - OFFSET - ESTIMATED_W;
		}
		if (containerHeight > 0 && top + ESTIMATED_H > containerHeight) {
			top = screenY - OFFSET - ESTIMATED_H;
		}
		if (left < 4) left = 4;
		if (top < 4) top = 4;
		return `left: ${left}px; top: ${top}px;`;
	});
</script>

<div class="map-tooltip" class:pinned style={positionStyle} role="tooltip">
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
				{headerLabel}
				{#if tile.is_capital}<span class="capital-marker">★</span>{/if}
			</span>
			{#if pinned && onClose}
				<button
					type="button"
					class="close-btn"
					onclick={onClose}
					aria-label="Close tooltip">×</button
				>
			{/if}
		</div>
	{:else if pinned && onClose}
		<button
			type="button"
			class="close-btn floating"
			onclick={onClose}
			aria-label="Close tooltip">×</button
		>
	{/if}

	<div class="rows">
		<span class="label">Tile</span>
		<span class="value">{tile.x}, {tile.y}</span>
		{#if terrainLabel}
			<span class="label">Terrain</span>
			<span class="value">{terrainLabel}</span>
		{/if}
		{#if improvementLabel}
			<span class="label">Improvement</span>
			<span class="value">{improvementLabel}</span>
		{/if}
		{#if specialistLabel}
			<span class="label">Specialist</span>
			<span class="value">{specialistLabel}</span>
		{/if}
	</div>
</div>

<style>
	.map-tooltip {
		position: absolute;
		background: rgba(26, 21, 16, 0.97);
		border: 2px solid var(--color-black);
		border-radius: 6px;
		padding: 8px 10px;
		color: var(--color-tan);
		font-size: 11px;
		line-height: 1.4;
		pointer-events: none;
		z-index: 100;
		min-width: 160px;
		max-width: 240px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
	}
	.map-tooltip.pinned {
		pointer-events: auto;
		border-color: var(--color-tan);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.7);
	}
	.header {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 6px;
		padding-bottom: 6px;
		border-bottom: 1px solid #3a2f24;
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
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
	}
	.capital-marker {
		margin-left: 4px;
		opacity: 0.85;
		font-size: 10px;
	}
	.close-btn {
		background: none;
		border: none;
		color: var(--color-brown);
		cursor: pointer;
		font-size: 16px;
		line-height: 1;
		padding: 0 2px;
		transition: color 0.15s;
		flex-shrink: 0;
	}
	.close-btn:hover {
		color: var(--color-tan);
	}
	.close-btn.floating {
		position: absolute;
		top: 4px;
		right: 6px;
	}
	.rows {
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 10px;
		row-gap: 2px;
		align-items: baseline;
	}
	.label {
		color: #7a6a55;
		font-size: 9.5px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.value {
		color: var(--color-tan);
	}
</style>
