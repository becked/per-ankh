<script lang="ts">
	import { resolve } from "$app/paths";
	import type { TournamentListItem } from "$lib/api-cloud";

	let { tournament }: { tournament: TournamentListItem } = $props();

	const statusLabel = $derived(
		{
			setup: "Setup",
			swiss: "Swiss",
			championship: "Championship",
			complete: "Complete",
		}[tournament.status],
	);
	const statusColor = $derived(
		{
			setup: "text-tan",
			swiss: "text-orange",
			championship: "text-orange",
			complete: "text-tan opacity-60",
		}[tournament.status],
	);
</script>

<a
	href={resolve("/tournaments/[slug]", { slug: tournament.slug })}
	class="block rounded border-2 border-black bg-blue-gray p-4 transition-colors hover:border-orange"
>
	<div class="flex items-baseline justify-between gap-2">
		<h3 class="truncate text-base font-bold text-tan">{tournament.name}</h3>
		<span class="whitespace-nowrap text-xs uppercase {statusColor}">
			{statusLabel}
		</span>
	</div>
	<p class="mt-1 truncate text-xs text-tan opacity-70">
		/tournaments/{tournament.slug}
	</p>
</a>
