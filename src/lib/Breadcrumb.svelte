<script module lang="ts">
	export interface Crumb {
		label: string;
		href?: string | null;
	}
</script>

<script lang="ts">
	// Navigation trail for leaf pages (game / tournament / user). The trail
	// is derived from the resource's canonical hierarchy (stable, reproducible
	// from the URL), not from click history — so a shared link, a refresh, or
	// a back-button re-entry all show the same ancestry.
	//
	// Each crumb with an `href` renders as a link (resting tan, gold on hover);
	// a crumb without one is the current page — plain bright text, not a link.
	// Conventionally only the last crumb omits its href. Separators are muted
	// and never gold. Text only by design (no leading icons).

	let { crumbs, class: className = "" }: { crumbs: Crumb[]; class?: string } =
		$props();
</script>

<nav aria-label="Breadcrumb" class={className}>
	<ol class="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-bold">
		{#each crumbs as crumb, i (i)}
			{#if i > 0}
				<li aria-hidden="true" class="select-none text-tan opacity-40">›</li>
			{/if}
			<li class="min-w-0">
				{#if crumb.href}
					<!-- hrefs are resolved by the caller (resolve()) and passed in as
					     strings; the rule can't see through the prop. -->
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a
						href={crumb.href}
						class="text-tan transition-colors hover:text-orange"
					>
						{crumb.label}
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{:else}
					<span class="text-gray-200" aria-current="page">{crumb.label}</span>
				{/if}
			</li>
		{/each}
	</ol>
</nav>
