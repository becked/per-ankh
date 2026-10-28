<script lang="ts" generics="K extends string">
	// The app's in-page segmented switch: an equal-column grid of buttons with a
	// raised-surface thumb that slides under the active one. The same control as
	// SegmentedNav, for the other half of the job — SegmentedNav's segments are
	// routes and are links, these are views of the route you are already on and
	// are buttons, so aria-pressed rather than aria-current, and the caller owns
	// the state rather than the URL.
	//
	// The thumb is the sole active indicator; the text stays tan on every
	// segment. Content-sized: `w-fit` over equal `1fr` columns takes every
	// segment's width from the longest label, which is what the thumb slides by.
	let {
		items,
		active,
		onSelect,
		ariaLabel,
	}: {
		items: { key: K; label: string }[];
		active: K;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onSelect: (key: K) => void;
		ariaLabel: string;
	} = $props();

	const activeIndex = $derived(items.findIndex((item) => item.key === active));
</script>

<div
	class="relative grid w-fit overflow-hidden rounded-lg border-2 border-surface-sunken bg-surface"
	style:grid-template-columns={`repeat(${items.length}, minmax(0, 1fr))`}
	role="group"
	aria-label={ariaLabel}
>
	<div
		class="pointer-events-none absolute inset-y-0 left-0 bg-surface-raised transition-transform duration-200 ease-out"
		style:width={`${100 / items.length}%`}
		style:transform={`translateX(${activeIndex * 100}%)`}
	></div>
	{#each items as item (item.key)}
		<button
			type="button"
			class="relative z-10 cursor-pointer whitespace-nowrap px-3 py-1.5 text-center text-xs font-bold text-tan transition-colors"
			aria-pressed={item.key === active}
			onclick={() => onSelect(item.key)}
		>
			{item.label}
		</button>
	{/each}
</div>
