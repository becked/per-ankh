<script lang="ts">
	import { resolve } from "$app/paths";
	import type { TournamentListItem } from "$lib/api-cloud";

	let {
		tournament,
		enrolled = false,
	}: { tournament: TournamentListItem; enrolled?: boolean } = $props();

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

	// Badge precedence:
	//   1. ✓ You're in — the most actionable; player already has a slot.
	//   2. Signups open — pre-signup tournaments in setup with the toggle on.
	//   3. fallback: phase status (Setup/Swiss/Championship/Complete).
	const badgeLabel = $derived(
		enrolled
			? "✓ You're in"
			: tournament.status === "setup" && tournament.signups_open
				? "Signups open"
				: statusLabel,
	);
	const badgeColor = $derived(
		enrolled || (tournament.status === "setup" && tournament.signups_open)
			? "text-orange"
			: statusColor,
	);
</script>

<a
	href={resolve("/tournaments/[slug]", { slug: tournament.slug })}
	class="block rounded border-2 border-black bg-blue-gray p-4 transition-colors hover:border-orange"
>
	<div class="flex items-baseline justify-between gap-2">
		<h3 class="truncate text-base font-bold text-tan">{tournament.name}</h3>
		<span class="whitespace-nowrap text-xs uppercase {badgeColor}">
			{badgeLabel}
		</span>
	</div>
	<p class="mt-1 truncate text-xs text-tan opacity-70">
		/tournaments/{tournament.slug}
	</p>
</a>
