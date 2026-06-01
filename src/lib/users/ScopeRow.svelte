<script lang="ts">
	// The scope selector — one dropdown choosing which slice of the library
	// every tab shows. The built-in slices (All / Public / vs AI /
	// Multiplayer / Tournament) and the user's collections are all
	// mutually-exclusive options, each showing its game count like
	// collections do. Hand-rolled popover (not a native <select>) to match
	// the game-detail action popups. Sits on the tab row; writes ?scope.

	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import type { CollectionInfo, ScopeCounts } from "$lib/api-cloud";
	import type { UserScope } from "$lib/stats/types";

	let {
		collections,
		scopeCounts,
		scope,
		isOwner,
	}: {
		collections: CollectionInfo[];
		scopeCounts: ScopeCounts;
		scope: UserScope;
		isOwner: boolean;
	} = $props();

	type Option = { value: string; label: string };
	type Group = { label: string | null; options: Option[] };

	const groups = $derived<Group[]>([
		{
			label: null,
			options: [
				{ value: "all", label: `All games (${scopeCounts.all})` },
				{ value: "public", label: `Public (${scopeCounts.public})` },
			],
		},
		{
			label: "By type",
			options: [
				{ value: "vs_ai", label: `vs AI (${scopeCounts.vs_ai})` },
				{ value: "mp", label: `Multiplayer (${scopeCounts.mp})` },
				{
					value: "tournament",
					label: `Tournament (${scopeCounts.tournament})`,
				},
			],
		},
		...(isOwner && collections.length > 0
			? [
					{
						label: "Collections",
						options: collections.map((c) => ({
							value: String(c.collection_id),
							label: `${c.name} (${c.game_count})`,
						})),
					},
				]
			: []),
	]);

	const selectValue = $derived(String(scope));
	const currentLabel = $derived(
		groups.flatMap((g) => g.options).find((o) => o.value === selectValue)
			?.label ?? "All games",
	);

	let open = $state(false);

	async function select(value: string) {
		open = false;
		if (value === selectValue) return;
		const next = new URL(page.url);
		if (value === "all") next.searchParams.delete("scope");
		else next.searchParams.set("scope", value);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- search-param-only update on the current route; URL objects are SvelteKit's documented dynamic-nav API
		await goto(next, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function handleClickOutside(e: MouseEvent) {
		if (!open) return;
		const target = e.target as HTMLElement;
		if (!target.closest(".scope-select")) open = false;
	}
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape" && open) open = false;
	}
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

<div class="scope-select relative">
	<button
		type="button"
		onclick={() => (open = !open)}
		aria-haspopup="menu"
		aria-expanded={open}
		class="flex items-center gap-2 rounded bg-surface px-2 py-1 text-sm text-tan transition-colors hover:bg-surface-hover"
	>
		<span>{currentLabel}</span>
		<span class="text-[9px] text-tan opacity-60">▼</span>
	</button>

	{#if open}
		<div
			class="action-popover absolute right-0 top-full z-50 mt-2 max-h-80 w-56 overflow-y-auto rounded border-2 border-black bg-blue-gray p-2 shadow-lg"
			role="menu"
			tabindex="-1"
		>
			{#each groups as group, gi (group.label ?? gi)}
				{#if group.label}
					<p
						class="mb-1 mt-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-tan opacity-60"
					>
						{group.label}
					</p>
				{/if}
				{#each group.options as o (o.value)}
					{@const isCurrent = o.value === selectValue}
					<button
						type="button"
						role="menuitemradio"
						aria-checked={isCurrent}
						onclick={() => select(o.value)}
						class="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs text-tan transition-colors hover:bg-surface-raised {isCurrent
							? 'bg-surface-raised'
							: ''}"
					>
						<span class="truncate">{o.label}</span>
						{#if isCurrent}
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-3.5 w-3.5 shrink-0 text-orange"
								viewBox="0 0 20 20"
								fill="currentColor"
								aria-hidden="true"
							>
								<path
									fill-rule="evenodd"
									d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
									clip-rule="evenodd"
								/>
							</svg>
						{/if}
					</button>
				{/each}
			{/each}
		</div>
	{/if}
</div>
