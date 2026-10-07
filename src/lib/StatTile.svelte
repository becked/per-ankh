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
		// Optional second line below the value, in the label's type — for a
		// value that carries its own spread (the Game length median's IQR). A
		// string rather than a snippet, matching `label`: the line is the
		// value's own annotation, not a slot for arbitrary markup.
		sub?: string;
	}
	let { label, icon, children, sub }: Props = $props();
</script>

<div class="rounded p-2" style="background-color: rgb(var(--color-surface));">
	<p class="mb-0.5 flex items-center gap-1 text-[10px] font-bold text-gray-400">
		{@render icon?.()}
		{label}
	</p>
	<p class="truncate text-sm font-bold text-bright">{@render children()}</p>
	{#if sub}
		<p class="mt-0.5 text-[10px] text-gray-400">{sub}</p>
	{/if}
</div>
