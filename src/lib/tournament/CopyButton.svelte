<script lang="ts">
	// Copy-to-clipboard button with the shared "Copied!" feedback swap. `text`
	// may be a thunk so reactive content (e.g. a $derived DM) is read at click
	// time; a null/empty result is a no-op. Renders `label` as text by default;
	// pass a `children` snippet (it receives the current `copied` state) to render
	// an icon instead — `label` stays the accessible name either way.
	import type { Snippet } from "svelte";
	import { copyToClipboard } from "$lib/utils/clipboard";

	let {
		text,
		label,
		copiedLabel = "Copied!",
		title,
		class: klass = "",
		children,
	}: {
		text: string | null | (() => string | null);
		label: string;
		copiedLabel?: string;
		title?: string;
		class?: string;
		children?: Snippet<[boolean]>;
	} = $props();

	let copied = $state(false);
	async function copy() {
		const t = typeof text === "function" ? text() : text;
		if (!t) return;
		if (await copyToClipboard(t)) {
			copied = true;
			setTimeout(() => (copied = false), 1500);
		}
	}
</script>

<button type="button" class={klass} {title} aria-label={label} onclick={copy}>
	{#if children}{@render children(copied)}{:else}{copied
			? copiedLabel
			: label}{/if}
</button>
