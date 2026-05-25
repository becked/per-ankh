<script lang="ts">
	import AboutDisclaimer from "$lib/AboutDisclaimer.svelte";

	interface Props {
		isOpen: boolean;
		onClose: () => void;
	}

	let { isOpen = $bindable(), onClose }: Props = $props();

	function onKeydown(e: KeyboardEvent) {
		if (isOpen && e.key === "Escape") {
			e.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
		onclick={onClose}
		role="presentation"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="w-full max-w-lg rounded-lg border-2 border-black bg-blue-gray p-6 shadow-lg"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			aria-labelledby="about-modal-title"
			tabindex="-1"
		>
			<h2
				id="about-modal-title"
				class="mb-4 border-b-2 border-orange pb-2 text-2xl font-bold text-tan"
			>
				About
			</h2>

			<AboutDisclaimer />

			<div class="mt-6 flex justify-end">
				<button
					type="button"
					class="rounded border border-tan px-4 py-2 text-sm text-tan transition-colors hover:border-orange hover:text-orange"
					onclick={onClose}
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}
