<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { cloudApi } from "$lib/api-cloud";
	import Breadcrumb, { type Crumb } from "$lib/Breadcrumb.svelte";
	import BulkUploadModal from "$lib/BulkUploadModal.svelte";
	import HieroglyphParade from "$lib/HieroglyphParade.svelte";
	import { loginBounce } from "$lib/utils/safe-next";
	import type { PageData } from "./$types";

	// Every mode's context — the challenge rules, the tournament name and
	// observer slot labels, the heading, the title — is resolved in +page.ts.
	let { data }: { data: PageData } = $props();

	let ready = $state(false);
	let paradeActive = $state(false);

	// Canonical trail for the two linked modes: a challenge run hangs off its
	// challenge, a tournament save off its tournament. A plain upload has no
	// parent to return to — the header's `?from=` drives Done instead — so it
	// gets no trail. The challenge crumb survives a failed context fetch: the
	// number is in the URL, and a reader who can't load the challenge is
	// exactly the one who needs the way back.
	const crumbs = $derived.by((): Crumb[] => {
		const trail: Crumb[] = [{ label: "Home", href: resolve("/") }];
		if (data.mode === "challenge") {
			trail.push({ label: "Challenges", href: resolve("/challenges") });
			if (data.challengeNumber !== null) {
				trail.push({
					label: data.challenge
						? `#${data.challenge.number} ${data.challenge.title}`
						: `#${data.challengeNumber}`,
					href: resolve("/challenges/[number]", {
						number: String(data.challengeNumber),
					}),
				});
			}
		} else if (data.mode === "tournament" && data.returnSlug) {
			trail.push({ label: "Tournaments", href: resolve("/tournaments") });
			trail.push({
				label: data.tournamentName ?? "Tournament",
				href: resolve("/tournaments/[slug]", { slug: data.returnSlug }),
			});
		}
		trail.push({ label: data.heading });
		return trail;
	});

	onMount(async () => {
		const me = await cloudApi.getMe();
		if (!me) {
			// loginBounce carries pathname + search, so a challenge or tournament
			// link survives the round trip through OAuth — bouncing on the
			// pathname alone landed the reader back on a context-less /upload.
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic next-query construction; resolve()'s branded types don't admit dynamic search strings
			await goto(loginBounce(page.url), { replaceState: true });
			return;
		}
		ready = true;
	});
</script>

<main class="flex-1 overflow-y-auto px-4 py-8">
	<div class="mx-auto max-w-xl">
		<HieroglyphParade active={paradeActive} />
		<div class="mb-8 mt-4">
			{#if data.mode !== "plain"}
				<Breadcrumb {crumbs} class="mb-2" />
			{/if}
			<h1 class="text-3xl font-bold text-gray-200">{data.heading}</h1>
		</div>
		{#if data.challengeError}
			<p class="mb-3 text-xs text-danger">
				Couldn't load the challenge: {data.challengeError}
			</p>
		{/if}
		{#if data.tournamentError}
			<p class="mb-3 text-xs text-orange">
				Couldn't load match info: {data.tournamentError}. The upload may still
				work — proceed and the worker will validate.
			</p>
		{/if}
		{#if ready && !data.challengeError}
			<BulkUploadModal
				onBusyChange={(busy) => (paradeActive = busy)}
				tournamentMatchId={data.tournamentMatchId}
				observerMode={data.observerMode}
				challenge={data.challenge}
				slotALabel={data.slotALabel ?? undefined}
				slotBLabel={data.slotBLabel ?? undefined}
				doneRedirect={data.tournamentMatchId && data.returnSlug
					? `${resolve("/tournaments/[slug]", { slug: data.returnSlug })}?match=${encodeURIComponent(data.tournamentMatchId)}`
					: data.challenge
						? resolve("/challenges/[number]", {
								number: String(data.challenge.number),
							})
						: (data.fromPath ?? undefined)}
			/>
		{:else if !data.challengeError}
			<!--
				A failed challenge fetch is terminal: the modal can't score a run
				without the rules, so the error line above is the whole answer and
				there is nothing left to wait for. "Loading…" under it promised a
				resolution that never came.
			-->
			<p class="text-sm text-gray-400">Loading…</p>
		{/if}
	</div>
</main>
