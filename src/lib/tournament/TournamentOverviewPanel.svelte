<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import {
		ApiError,
		cloudApi,
		type PatchTournamentBody,
		type TournamentDetail,
	} from "$lib/api-cloud";
	import { toast } from "$lib/ui/toast";

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

	async function commit(patch: PatchTournamentBody) {
		if (Object.keys(patch).length === 0) return;
		try {
			await cloudApi.patchTournament(tournament.tournament_id, patch);
			await invalidateAll();
			toast.info("Saved");
		} catch (err) {
			let message = "Save failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			toast.error(message);
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
	<h2 class="mb-3 text-sm font-bold text-tan">Overview</h2>

	<div class="flex flex-col gap-3 text-xs text-tan">
		<label class="flex flex-col gap-1">
			<span>Name</span>
			<input
				type="text"
				bind:value={name}
				onblur={commitName}
				class="rounded border border-[#4a433b] bg-[#35302b] p-1.5 focus:border-[#5a524a] focus:outline-none"
			/>
		</label>

		<label class="flex flex-col gap-1">
			<span>Description</span>
			<textarea
				bind:value={description}
				onblur={commitDescription}
				rows="2"
				class="rounded border border-[#4a433b] bg-[#35302b] p-1.5 focus:border-[#5a524a] focus:outline-none"
			></textarea>
		</label>

		<label class="flex flex-col gap-1">
			<span>Division A name</span>
			<input
				type="text"
				bind:value={divisionAName}
				onblur={commitDivisionA}
				class="rounded border border-[#4a433b] bg-[#35302b] p-1.5 focus:border-[#5a524a] focus:outline-none"
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span>Division B name</span>
			<input
				type="text"
				bind:value={divisionBName}
				onblur={commitDivisionB}
				class="rounded border border-[#4a433b] bg-[#35302b] p-1.5 focus:border-[#5a524a] focus:outline-none"
			/>
		</label>
	</div>
</section>
