<script lang="ts">
	import { resolve } from "$app/paths";
	import type { TournamentListItem } from "$lib/api-cloud";

	// `compact` shrinks padding and font sizes for the home page's narrow
	// right sidebar; default sizing is for the /tournaments listing.
	let {
		tournament,
		enrolled = false,
		compact = false,
	}: {
		tournament: TournamentListItem;
		enrolled?: boolean;
		compact?: boolean;
	} = $props();

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
	class="block rounded transition-colors hover:bg-[#3e3833] {compact
		? 'p-2'
		: 'p-4'}"
	style="background-color: #2a2622;"
>
	<h3
		class="truncate font-bold text-[#DBDEE3] {compact
			? 'text-xs'
			: 'text-base'}"
	>
		{tournament.name}
	</h3>
	<p
		class="mt-0.5 truncate uppercase {badgeColor} {compact
			? 'text-[10px]'
			: 'text-xs'}"
	>
		{badgeLabel}
	</p>
</a>
