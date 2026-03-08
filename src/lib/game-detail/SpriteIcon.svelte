<script lang="ts">
	import { type SpriteCategory, getSpritePath } from "./helpers";

	let {
		category,
		value,
		size = 24,
		alt = "",
	}: {
		category: SpriteCategory;
		value: string;
		size?: number;
		alt?: string;
	} = $props();

	let failed = $state(false);
	const spritePath = $derived(getSpritePath(category, value));
</script>

{#if spritePath && !failed}
	<img
		src={spritePath}
		{alt}
		class="inline-block"
		style="width: {size}px; height: {size}px;"
		onerror={() => (failed = true)}
	/>
{/if}
