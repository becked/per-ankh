<script lang="ts">
	// The line above a chart or a board naming what it is drawn from — "412
	// Games", "1,247 Leaders · 83 with no recorded archetype". GameLengthPanel,
	// RecordsPanel and LeaderArchetypesPanel each carried the same <p> with the
	// same three classes; one component so a fourth panel can't spell it a
	// fourth way.
	//
	// tan/70 rather than the `brown` those three carried: --color-brown is
	// #a52a2a — the CSS keyword `brown`, which reads as a warning red — and it
	// clears only 2.1:1 on `bg-surface`, under the 4.5:1 body text needs. tan/70
	// is 4.5:1 on the same surface. The app's other `text-brown` sites are a
	// separate question; this row is the one the three panels share.
	import type { Snippet } from "svelte";

	let { children }: { children: Snippet } = $props();
</script>

<p class="mb-3 text-xs text-tan/70">{@render children()}</p>
