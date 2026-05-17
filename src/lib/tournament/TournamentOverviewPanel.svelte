<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import {
		ApiError,
		cloudApi,
		type PatchTournamentBody,
		type TournamentDetail,
	} from "$lib/api-cloud";

	interface Props {
		tournament: TournamentDetail;
	}

	let { tournament }: Props = $props();

	// svelte-ignore state_referenced_locally
	let name = $state(tournament.name);
	// svelte-ignore state_referenced_locally
	let description = $state(tournament.description ?? "");
	// svelte-ignore state_referenced_locally
	let divisionAName = $state(tournament.division_a_name);
	// svelte-ignore state_referenced_locally
	let divisionBName = $state(tournament.division_b_name);

	let status = $state<
		| { kind: "idle" }
		| { kind: "saving" }
		| { kind: "saved" }
		| { kind: "err"; message: string }
	>({ kind: "idle" });

	async function commit(patch: PatchTournamentBody) {
		if (Object.keys(patch).length === 0) return;
		status = { kind: "saving" };
		try {
			await cloudApi.patchTournament(tournament.tournament_id, patch);
			await invalidateAll();
			status = { kind: "saved" };
		} catch (err) {
			let message = "Save failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			status = { kind: "err", message };
		}
	}

	function commitName() {
		const trimmed = name.trim();
		if (!trimmed) {
			name = tournament.name; // empty name not allowed — revert
			return;
		}
		if (trimmed === tournament.name) return;
		commit({ name: trimmed });
	}

	function commitDescription() {
		const next = description.trim() || null;
		if (next === tournament.description) return;
		commit({ description: next });
	}

	function commitDivisionA() {
		const trimmed = divisionAName.trim();
		if (!trimmed) {
			divisionAName = tournament.division_a_name;
			return;
		}
		if (trimmed === tournament.division_a_name) return;
		commit({ division_a_name: trimmed });
	}

	function commitDivisionB() {
		const trimmed = divisionBName.trim();
		if (!trimmed) {
			divisionBName = tournament.division_b_name;
			return;
		}
		if (trimmed === tournament.division_b_name) return;
		commit({ division_b_name: trimmed });
	}
</script>

<section class="mb-6 rounded-lg p-4" style="background-color: #2a2622;">
	<header class="mb-3 flex items-baseline justify-between">
		<h2 class="text-sm font-bold text-tan">Overview</h2>
		{#if status.kind === "saving"}
			<span class="text-xs text-tan opacity-60">Saving…</span>
		{:else if status.kind === "saved"}
			<span class="text-xs text-orange opacity-80">Saved</span>
		{:else if status.kind === "err"}
			<span class="text-xs text-red-400">{status.message}</span>
		{/if}
	</header>

	<div class="flex flex-col gap-3 text-xs text-tan">
		<label class="flex flex-col gap-1">
			<span>Name</span>
			<input
				type="text"
				bind:value={name}
				onblur={commitName}
				class="rounded border border-black bg-[#35302b] p-1.5"
			/>
		</label>

		<label class="flex flex-col gap-1">
			<span>Description</span>
			<textarea
				bind:value={description}
				onblur={commitDescription}
				rows="2"
				class="rounded border border-black bg-[#35302b] p-1.5"
			></textarea>
		</label>

		<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
			<label class="flex flex-col gap-1">
				<span>Division A name</span>
				<input
					type="text"
					bind:value={divisionAName}
					onblur={commitDivisionA}
					class="rounded border border-black bg-[#35302b] p-1.5"
				/>
			</label>
			<label class="flex flex-col gap-1">
				<span>Division B name</span>
				<input
					type="text"
					bind:value={divisionBName}
					onblur={commitDivisionB}
					class="rounded border border-black bg-[#35302b] p-1.5"
				/>
			</label>
		</div>
	</div>
</section>
