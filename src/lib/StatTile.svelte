<script lang="ts">
	// Small labelled stat box: a rounded surface tile with an icon + label
	// caption above a bold value. Shared by the recent-save card and the
	// tournament row card, which previously each inlined this markup per stat.
	import type { Snippet } from "svelte";

	interface Props {
		label: string;
		// Optional leading icon (typically a <SpriteIcon size={10} />).
		icon?: Snippet;
		// The value content (text or inline markup).
		children: Snippet;
	}
	let { label, icon, children }: Props = $props();
</script>

<div class="rounded p-2" style="background-color: rgb(var(--color-surface));">
	<p class="mb-0.5 flex items-center gap-1 text-[10px] font-bold text-gray-400">
		{@render icon?.()}
		{label}
	</p>
	<p class="truncate text-sm font-bold text-bright">{@render children()}</p>
</div>
