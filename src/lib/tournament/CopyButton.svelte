<script lang="ts">
	// Copy-to-clipboard button with the shared "Copied!" feedback swap. `text`
	// may be a thunk so reactive content (e.g. a $derived DM) is read at click
	// time; a null/empty result is a no-op.
	import { copyToClipboard } from "$lib/utils/clipboard";

	let {
		text,
		label,
		copiedLabel = "Copied!",
		title,
		class: klass = "",
	}: {
		text: string | null | (() => string | null);
		label: string;
		copiedLabel?: string;
		title?: string;
		class?: string;
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

<button type="button" class={klass} {title} onclick={copy}>
	{copied ? copiedLabel : label}
</button>
