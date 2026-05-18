<script lang="ts">
	import { resolve } from "$app/paths";
	import { cloudApi, type MyTournamentEntry } from "$lib/api-cloud";
	import {
		markTournamentDismissed,
		tournamentNotices,
	} from "$lib/stores/tournamentNotice";

	// Mirror the store value into $state via the rune-friendly subscribe
	// pattern (see CLAUDE.md "Stores with runes" section).
	let notices = $state<MyTournamentEntry[]>([]);

	$effect(() => {
		const unsub = tournamentNotices.subscribe((v) => {
			notices = v;
		});
		return unsub;
	});

	async function dismiss(tournamentId: string) {
		markTournamentDismissed(tournamentId);
		try {
			await cloudApi.dismissTournamentBanner(tournamentId);
		} catch {
			// Server-side dismiss failed but the in-memory store already hides
			// it for this session; the banner will reappear on next navigation
			// (invalidateAll re-fetches /users/me/tournaments and repopulates).
			// Acceptable degraded state — no retry surface for the user. Errors
			// are intentionally swallowed; the operation is purely cosmetic.
		}
	}
</script>

{#if notices.length > 0}
	<div class="flex flex-col gap-1 border-b border-black bg-blue-gray">
		{#each notices as t (t.tournament_id)}
			<div
				class="flex items-center justify-between gap-2 px-4 py-2 text-xs text-tan"
			>
				<span>
					You're signed up for
					<a
						href={resolve("/tournaments/[slug]", { slug: t.slug })}
						class="font-bold text-orange hover:underline"
					>
						{t.name}
					</a>
					{#if t.division}
						· {t.division === "A" ? "Division A" : "Division B"}
					{/if}
				</span>
				<button
					type="button"
					class="text-tan opacity-60 hover:opacity-100"
					onclick={() => dismiss(t.tournament_id)}
					aria-label="Dismiss"
				>
					×
				</button>
			</div>
		{/each}
	</div>
{/if}
