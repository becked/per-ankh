<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import {
		ApiError,
		cloudApi,
		type CreateTournamentBody,
	} from "$lib/api-cloud";
	import {
		DLC_GROUP_LABELS,
		mapScriptLabel,
		unaddedMapScriptsByDlc,
	} from "$lib/tournament/map-scripts";

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	// Defaults mirror cloud/migrations/0006_tournaments.sql so what the user
	// sees in the form matches what the DB stores when they leave fields
	// alone.
	let name = $state("");
	let description = $state("");
	let divisionAName = $state("Division A");
	let divisionBName = $state("Division B");
	let swissMaxRounds = $state(5);
	let swissWinsToAdvance = $state(3);
	let swissLossesToEliminate = $state(3);
	let allowedMapScripts = $state<string[]>([]);

	let busy = $state(false);
	let banner = $state<{ kind: "ok" | "err"; message: string } | null>(null);

	const unaddedGroups = $derived(unaddedMapScriptsByDlc(allowedMapScripts));

	const canSubmit = $derived(
		!busy &&
			name.trim().length > 0 &&
			divisionAName.trim().length > 0 &&
			divisionBName.trim().length > 0 &&
			allowedMapScripts.length > 0 &&
			swissMaxRounds > 0 &&
			swissWinsToAdvance > 0 &&
			swissLossesToEliminate > 0,
	);

	function addMapScript(value: string) {
		if (!value) return;
		if (!allowedMapScripts.includes(value)) {
			allowedMapScripts = [...allowedMapScripts, value];
		}
	}

	function removeMapScript(script: string) {
		allowedMapScripts = allowedMapScripts.filter((s) => s !== script);
	}

	function buildBody(): CreateTournamentBody {
		const body: CreateTournamentBody = {
			name: name.trim(),
			allowed_map_scripts: allowedMapScripts,
		};
		const trimmedDesc = description.trim();
		if (trimmedDesc) body.description = trimmedDesc;
		const trimmedA = divisionAName.trim();
		if (trimmedA && trimmedA !== "Division A") body.division_a_name = trimmedA;
		const trimmedB = divisionBName.trim();
		if (trimmedB && trimmedB !== "Division B") body.division_b_name = trimmedB;
		if (swissMaxRounds !== 5) body.swiss_max_rounds = swissMaxRounds;
		if (swissWinsToAdvance !== 3)
			body.swiss_wins_to_advance = swissWinsToAdvance;
		if (swissLossesToEliminate !== 3)
			body.swiss_losses_to_eliminate = swissLossesToEliminate;
		return body;
	}

	async function submit() {
		if (!canSubmit) return;
		busy = true;
		banner = null;
		try {
			const { tournament } = await cloudApi.createTournament(buildBody());
			// Refresh the layout-level my-tournaments / admin-tournaments
			// so the header dropdown picks up the new tournament before we
			// navigate (the user is now its sole admin).
			await invalidateAll();
			await goto(resolve("/tournaments/[slug]", { slug: tournament.slug }));
		} catch (err) {
			let message = "Create failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			banner = { kind: "err", message };
			busy = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape" && !busy) {
			e.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
	onclick={onClose}
	role="presentation"
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border-2 border-black bg-blue-gray p-5 shadow-lg"
		onclick={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="create-modal-title"
		tabindex="-1"
	>
		<header class="mb-4 flex items-baseline justify-between gap-3">
			<h2
				id="create-modal-title"
				class="border-b-2 border-orange pb-1 text-lg font-bold text-tan"
			>
				New tournament
			</h2>
			<button
				type="button"
				class="text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
				onclick={onClose}
				aria-label="Close"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M6 18L18 6M6 6l12 12"
					/>
				</svg>
			</button>
		</header>

		{#if banner}
			<div
				class="mb-3 rounded border px-3 py-2 text-sm"
				class:border-red-500={banner.kind === "err"}
				class:text-red-400={banner.kind === "err"}
				role="status"
			>
				{banner.message}
			</div>
		{/if}

		<div class="flex flex-col gap-3 text-xs text-tan">
			<label class="flex flex-col gap-1">
				<span>Name</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="text"
					bind:value={name}
					autofocus
					maxlength="120"
					class="rounded border border-black bg-[#35302b] p-1.5"
				/>
			</label>

			<label class="flex flex-col gap-1">
				<span>Description <span class="opacity-60">(optional)</span></span>
				<textarea
					bind:value={description}
					rows="2"
					maxlength="2000"
					class="rounded border border-black bg-[#35302b] p-1.5"
				></textarea>
			</label>

			<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
				<label class="flex flex-col gap-1">
					<span>Division A name</span>
					<input
						type="text"
						bind:value={divisionAName}
						maxlength="64"
						class="rounded border border-black bg-[#35302b] p-1.5"
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span>Division B name</span>
					<input
						type="text"
						bind:value={divisionBName}
						maxlength="64"
						class="rounded border border-black bg-[#35302b] p-1.5"
					/>
				</label>
			</div>

			<fieldset class="rounded border border-black border-opacity-50 p-3">
				<legend class="px-1 text-xs opacity-70">Swiss configuration</legend>
				<div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
					<label class="flex flex-col gap-1">
						<span>Max rounds</span>
						<input
							type="number"
							min="1"
							max="20"
							bind:value={swissMaxRounds}
							class="rounded border border-black bg-[#35302b] p-1.5"
						/>
					</label>
					<label class="flex flex-col gap-1">
						<span>Wins to advance</span>
						<input
							type="number"
							min="1"
							max="20"
							bind:value={swissWinsToAdvance}
							class="rounded border border-black bg-[#35302b] p-1.5"
						/>
					</label>
					<label class="flex flex-col gap-1">
						<span>Losses to eliminate</span>
						<input
							type="number"
							min="1"
							max="20"
							bind:value={swissLossesToEliminate}
							class="rounded border border-black bg-[#35302b] p-1.5"
						/>
					</label>
				</div>
			</fieldset>

			<div class="flex flex-col gap-2">
				<span>Allowed map scripts</span>
				{#if allowedMapScripts.length === 0}
					<p class="text-tan opacity-60">
						Pick at least one map. Match generation rotates through these.
					</p>
				{:else}
					<ul class="flex flex-wrap gap-1.5">
						{#each allowedMapScripts as script (script)}
							<li
								class="inline-flex items-center gap-1.5 rounded border border-black bg-[#35302b] py-0.5 pl-2 pr-1"
								title={script}
							>
								<span>{mapScriptLabel(script)}</span>
								<button
									type="button"
									class="text-tan opacity-60 transition-colors hover:text-red-400 hover:opacity-100 disabled:opacity-30"
									onclick={() => removeMapScript(script)}
									disabled={busy}
									aria-label="Remove {mapScriptLabel(script)}"
								>
									×
								</button>
							</li>
						{/each}
					</ul>
				{/if}
				<select
					value=""
					onchange={(e) => {
						const target = e.target as HTMLSelectElement;
						addMapScript(target.value);
						target.value = "";
					}}
					disabled={busy || unaddedGroups.length === 0}
					class="mt-1 rounded border border-black bg-[#35302b] p-1.5 disabled:opacity-50"
					aria-label="Add map script"
				>
					<option value="" disabled>
						{unaddedGroups.length === 0 ? "All known maps added" : "Add a map…"}
					</option>
					{#each unaddedGroups as group (group.dlc)}
						<optgroup label={DLC_GROUP_LABELS[group.dlc]}>
							{#each group.entries as entry (entry.value)}
								<option value={entry.value}>{entry.label}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</div>
		</div>

		<div class="mt-4 flex justify-end gap-2">
			<button
				type="button"
				class="rounded border border-brown px-3 py-1.5 text-xs text-tan transition-colors hover:bg-brown disabled:opacity-50"
				onclick={onClose}
				disabled={busy}
			>
				Cancel
			</button>
			<button
				type="button"
				class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan disabled:opacity-50"
				onclick={submit}
				disabled={!canSubmit}
			>
				{busy ? "Creating…" : "Create"}
			</button>
		</div>
	</div>
</div>
