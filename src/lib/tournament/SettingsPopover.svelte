<script lang="ts">
	import type { TournamentDetail } from "$lib/api-cloud";
	import Popover from "$lib/ui/Popover.svelte";
	import TournamentMapPoolSummary from "./TournamentMapPoolSummary.svelte";
	import TournamentSettingsForm from "./TournamentSettingsForm.svelte";

	interface Props {
		tournament: TournamentDetail;
		// Disabled while a match popover is open (shallow-routing guard).
		disabled?: boolean;
	}

	let { tournament, disabled = false }: Props = $props();

	let open = $state(false);

	const isAdmin = $derived(tournament.is_viewer_admin === true);
</script>

<Popover
	bind:open
	ariaLabel="Tournament settings"
	contentClass="w-[min(95vw,56rem)]"
>
	{#snippet trigger({ props })}
		<button
			{...props}
			type="button"
			class="whitespace-nowrap rounded border border-tan px-2.5 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
			{disabled}
			aria-label="Tournament settings"
		>
			Settings
		</button>
	{/snippet}

	<header class="mb-4 flex items-baseline justify-between gap-3">
		<h2 class="border-b-2 border-orange pb-1 text-lg font-bold text-tan">
			Tournament settings
		</h2>
		<button
			type="button"
			class="text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
			onclick={() => (open = false)}
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

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
		<div class="rounded-lg p-4" style="background-color: #2a2622;">
			<TournamentSettingsForm
				{tournament}
				canEdit={isAdmin}
				onSaved={() => (open = false)}
				onCancel={() => (open = false)}
			/>
		</div>
		<div>
			<TournamentMapPoolSummary mapPool={tournament.map_pool} />
		</div>
	</div>
</Popover>
