<script lang="ts">
	import AboutDisclaimer from "$lib/AboutDisclaimer.svelte";

	interface Props {
		isOpen: boolean;
		onClose: () => void;
	}

	let { isOpen = $bindable(), onClose }: Props = $props();
</script>

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
	>
		<div
			class="mx-4 w-full max-w-lg rounded-lg border-2 border-black bg-blue-gray p-6 shadow-lg"
		>
			<h2
				class="mb-4 border-b-2 border-orange pb-2 text-2xl font-bold text-tan"
			>
				About
			</h2>

			<AboutDisclaimer />

			<div class="mt-6 flex justify-end">
				<button
					type="button"
					class="rounded border border-brown px-4 py-2 text-sm text-tan transition-colors hover:bg-brown"
					onclick={onClose}
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}
