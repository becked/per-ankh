<script lang="ts">
	// Shared styled progress bar (wraps bits-ui Progress.Root). The Root owns
	// the ARIA role + data-state/data-value attributes; we render the fill as a
	// child and drive its width from value/max. Callers theme the fill via
	// `indicatorClass` (the tournament header uses the brand `bg-orange`) and
	// may restyle the track via `class`.
	import { Progress } from "bits-ui";

	let {
		value = 0,
		max = 100,
		class: klass = "",
		indicatorClass = "bg-tan",
	}: {
		value?: number;
		max?: number;
		class?: string;
		indicatorClass?: string;
	} = $props();

	const pct = $derived(
		max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0,
	);
</script>

<Progress.Root
	{value}
	{max}
	class="relative h-1 w-full overflow-hidden rounded-full bg-[#4a433b] {klass}"
>
	<div
		class="h-full rounded-full transition-[width] duration-300 {indicatorClass}"
		style="width: {pct}%"
	></div>
</Progress.Root>
