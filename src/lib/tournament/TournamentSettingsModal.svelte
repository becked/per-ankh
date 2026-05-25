<script lang="ts">
	import type { TournamentDetail } from "$lib/api-cloud";
	import TournamentMapPoolSummary from "./TournamentMapPoolSummary.svelte";
	import TournamentSettingsForm from "./TournamentSettingsForm.svelte";

	interface Props {
		tournament: TournamentDetail;
		onClose: () => void;
	}

	let { tournament, onClose }: Props = $props();

	const isAdmin = $derived(tournament.is_viewer_admin === true);

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
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
		class="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border-2 border-black bg-blue-gray p-5 shadow-lg"
		onclick={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="settings-modal-title"
		tabindex="-1"
	>
		<header class="mb-4 flex items-baseline justify-between gap-3">
			<h2
				id="settings-modal-title"
				class="border-b-2 border-orange pb-1 text-lg font-bold text-tan"
			>
				Tournament settings
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

		<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
			<div class="rounded-lg p-4" style="background-color: #2a2622;">
				<TournamentSettingsForm
					{tournament}
					canEdit={isAdmin}
					onSaved={onClose}
					onCancel={onClose}
				/>
			</div>
			<div>
				<TournamentMapPoolSummary mapPool={tournament.map_pool} />
			</div>
		</div>
	</div>
</div>
