<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { cloudApi } from "$lib/api-cloud";
	import type { ChallengeRules } from "$lib/challenges/types";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import { safeNext } from "$lib/utils/safe-next";
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
	// Challenge context: the rules the modal scores the save against before
	// upload. Resolved from ?challenge_id=X&return_number=N.
	let challengeRules = $state<ChallengeRules | null>(null);
	let challengeContextError = $state<string | null>(null);

	// Optional tournament-match link. When the upload page is reached via
	// /upload?tournament_match_id=X&return_slug=Y, the upload is forwarded
	// to the worker with the link field, which auto-publics the game and
	// drops it into the user's "Tournament: {name}" collection. ?observer=1
	// switches the modal into observer mode (admin uploading on behalf).
	const tournamentMatchId = $derived(
		page.url.searchParams.get("tournament_match_id"),
	);
	const returnSlug = $derived(page.url.searchParams.get("return_slug"));
	// A challenge run is always played from the map's own seat, so observer
	// mode is meaningless there — the flag is ignored rather than honoured.
	const observerMode = $derived(
		page.url.searchParams.get("challenge_id") === null &&
			page.url.searchParams.get("observer") === "1",
	);
	// Optional challenge-run link (/upload?challenge_id=X&return_number=N):
	// the upload is scored against the challenge and lands on its leaderboard.
	const challengeId = $derived(page.url.searchParams.get("challenge_id"));
	const returnNumber = $derived(
		Number(page.url.searchParams.get("return_number")) || null,
	);
	// The page the upload was launched from (set by the header Upload link).
	// Sanitized to a same-origin path so Done returns the user where they came
	// from rather than always to their profile. Null when absent.
	const fromPath = $derived(
		page.url.searchParams.has("from")
			? safeNext(page.url.searchParams.get("from"))
			: null,
	);
	const showBackLink = $derived(
		tournamentMatchId !== null && returnSlug !== null,
	);

	onMount(async () => {
		const me = await cloudApi.getMe();
		if (!me) {
			const next = encodeURIComponent(page.url.pathname);
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic next-query construction; resolve()'s branded types don't admit dynamic search strings
			await goto(`/?next=${next}`, { replaceState: true });
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
						if (s.display_name) labelById[s.slot_id] = s.display_name;
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
		// Challenge mode needs the rules up front — without them the modal
		// can't score the save, so this one is a hard requirement.
		if (challengeId && !returnNumber) {
			challengeContextError = "Challenge link is incomplete.";
		} else if (challengeId && returnNumber) {
			try {
				const { challenge } = await cloudApi.getChallenge(returnNumber);
				if (challenge.challenge_id !== challengeId) {
					challengeContextError = "Challenge link doesn't match.";
				} else {
					challengeRules = {
						setup: challenge.setup,
						objectives: challenge.objectives,
						criteria: challenge.criteria,
					};
				}
			} catch (err) {
				challengeContextError =
					err instanceof Error ? err.message : "Failed to load challenge";
			}
		}
		ready = true;
	});

	const challenge = $derived(
		challengeId && challengeRules
			? { challenge_id: challengeId, rules: challengeRules }
			: null,
	);
</script>

<svelte:head>
	<title>Upload - Per-Ankh</title>
</svelte:head>

<main class="cloud-scroll flex-1 overflow-y-auto px-4 py-8" use:autohideScroll>
	<div class="mx-auto max-w-xl">
		<HieroglyphParade active={paradeActive} />
		<h1 class="mb-8 mt-4 text-3xl font-bold text-gray-200">
			{challenge ? "Submit run" : "Upload"}
		</h1>
		{#if challengeContextError}
			<p class="mb-3 text-xs text-danger">
				Couldn't load the challenge: {challengeContextError}
			</p>
		{/if}
		{#if showBackLink && tournamentContextError}
			<p class="mb-3 text-xs text-orange">
				Couldn't load match info: {tournamentContextError}. The upload may still
				work — proceed and the worker will validate.
			</p>
		{/if}
		{#if ready && !challengeContextError}
			<BulkUploadModal
				onBusyChange={(busy) => (paradeActive = busy)}
				{tournamentMatchId}
				{observerMode}
				{challenge}
				slotALabel={slotALabel ?? undefined}
				slotBLabel={slotBLabel ?? undefined}
				doneRedirect={tournamentMatchId && returnSlug
					? `${resolve("/tournaments/[slug]", { slug: returnSlug })}?match=${encodeURIComponent(tournamentMatchId)}`
					: challenge && returnNumber
						? resolve("/challenges/[number]", { number: String(returnNumber) })
						: (fromPath ?? undefined)}
			/>
		{:else}
			<p class="text-sm text-gray-400">Loading…</p>
		{/if}
	</div>
</main>
