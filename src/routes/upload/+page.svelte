<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { cloudApi } from "$lib/api-cloud";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import BulkUploadModal from "$lib/BulkUploadModal.svelte";
	import HieroglyphParade from "$lib/HieroglyphParade.svelte";

	let ready = $state(false);
	let paradeActive = $state(false);
	// Tournament context resolved from the URL params. Only fetched when
	// tournament_match_id is present; observer mode (?observer=1) also
	// needs the slot labels for the BulkUploadModal's mapping picker.
	let slotALabel = $state<string | null>(null);
	let slotBLabel = $state<string | null>(null);
	let tournamentContextError = $state<string | null>(null);

	// Optional tournament-match link. When the upload page is reached via
	// /upload?tournament_match_id=X&return_slug=Y, the upload is forwarded
	// to the worker with the link field, which auto-publics the game and
	// drops it into the user's "Tournament: {name}" collection. ?observer=1
	// switches the modal into observer mode (admin uploading on behalf).
	const tournamentMatchId = $derived(
		page.url.searchParams.get("tournament_match_id"),
	);
	const returnSlug = $derived(page.url.searchParams.get("return_slug"));
	const observerMode = $derived(page.url.searchParams.get("observer") === "1");
	const showBackLink = $derived(
		tournamentMatchId !== null && returnSlug !== null,
	);

	onMount(async () => {
		const me = await cloudApi.getMe();
		if (!me) {
			await goto(resolve("/?next=/upload"), { replaceState: true });
			return;
		}
		// In observer mode, load the match + standings so we can show "Slot A
		// (becked) played as: ..." in the picker. Failure here doesn't block
		// the upload page entirely — the modal will fall back to non-labeled
		// "Slot A / Slot B" labels and the worker will validate the mapping.
		if (tournamentMatchId && returnSlug && observerMode) {
			try {
				const tournament = await cloudApi.getTournament(returnSlug);
				const [match, standings] = await Promise.all([
					cloudApi.getTournamentMatch(
						tournament.tournament_id,
						tournamentMatchId,
					),
					cloudApi.getTournamentStandings(tournament.tournament_id),
				]);
				const labelById: Record<string, string> = {};
				for (const div of ["A", "B"] as const) {
					for (const s of standings.divisions[div].standings) {
						if (s.discord_username) labelById[s.slot_id] = s.discord_username;
					}
				}
				slotALabel = labelById[match.slot_a_id] ?? "Slot A";
				slotBLabel = match.slot_b_id
					? (labelById[match.slot_b_id] ?? "Slot B")
					: "BYE";
			} catch (err) {
				tournamentContextError =
					err instanceof Error ? err.message : "Failed to load match info";
			}
		}
		ready = true;
	});
</script>

<svelte:head>
	<title>Upload — Per-Ankh</title>
</svelte:head>

<main class="cloud-scroll flex-1 overflow-y-auto px-4 py-8" use:autohideScroll>
	<div class="mx-auto max-w-xl">
		<HieroglyphParade active={paradeActive} />
		<h1 class="mb-8 mt-4 text-3xl font-bold text-gray-200">Upload</h1>
		{#if showBackLink && tournamentContextError}
			<p class="mb-3 text-xs text-orange">
				Couldn't load match info: {tournamentContextError}. The upload may still
				work — proceed and the worker will validate.
			</p>
		{/if}
		{#if ready}
			<BulkUploadModal
				onBusyChange={(busy) => (paradeActive = busy)}
				{tournamentMatchId}
				{observerMode}
				slotALabel={slotALabel ?? undefined}
				slotBLabel={slotBLabel ?? undefined}
				doneRedirect={tournamentMatchId && returnSlug
					? resolve("/tournaments/[slug]/matches/[match_id]", {
							slug: returnSlug,
							match_id: tournamentMatchId,
						})
					: undefined}
			/>
		{:else}
			<p class="text-sm text-gray-400">Loading…</p>
		{/if}
	</div>
</main>
