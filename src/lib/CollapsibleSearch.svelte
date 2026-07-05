<script lang="ts">
	// A search control that collapses to a single icon and expands to an inline
	// input when clicked — the same interaction as the app header's game search
	// (CloudHeader/HeaderGameSearch), but as a plain value filter rather than a
	// navigational lookup. It collapses again on Escape or when focus leaves while
	// empty; a non-empty term always stays expanded so an active filter is never
	// hidden behind the icon.
	import SearchInput from "$lib/SearchInput.svelte";

	let {
		value = $bindable(""),
		class: className = "",
		ariaLabel = "Search",
		placeholder = "",
	}: {
		value?: string;
		class?: string;
		ariaLabel?: string;
		placeholder?: string;
	} = $props();

	// Start expanded when a term is already present (e.g. remounting after the
	// control was hidden) so an active filter is visible, not stranded behind the
	// icon.
	let expanded = $state(value.trim().length > 0);

	function collapseIfEmpty() {
		if (value.trim() === "") expanded = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") collapseIfEmpty();
	}

	// Focus leaving the control (not merely moving within it) collapses it when
	// empty. relatedTarget is where focus is going.
	function handleFocusOut(e: FocusEvent) {
		const next = e.relatedTarget as HTMLElement | null;
		if (next && next.closest(".collapsible-search")) return;
		collapseIfEmpty();
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest(".collapsible-search")) collapseIfEmpty();
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="collapsible-search">
	{#if expanded}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class={className} onkeydown={handleKeydown} onfocusout={handleFocusOut}>
			<SearchInput bind:value variant="dark" {placeholder} autofocus />
		</div>
	{:else}
		<button
			type="button"
			onclick={(e) => {
				// Stop this click reaching the window listener above — otherwise its
				// click-outside check fires for this very click and (the term being
				// empty) collapses the input the same synchronous flush it opened.
				e.stopPropagation();
				expanded = true;
			}}
			class="inline-flex items-center justify-center rounded border border-surface p-1.5 text-tan transition-colors hover:bg-surface-hover hover:text-orange"
			aria-label={ariaLabel}
			title={ariaLabel}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
				/>
			</svg>
		</button>
	{/if}
</div>
