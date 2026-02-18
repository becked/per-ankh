<script lang="ts">
	import { type Snippet } from "svelte";
	import type { EChartsOption } from "echarts";
	import Chart from "$lib/Chart.svelte";

	let {
		option,
		height = "400px",
		title = "Chart",
		controls,
	}: {
		option: EChartsOption;
		height?: string;
		title?: string;
		controls?: Snippet;
	} = $props();

	let dialogRef: HTMLDialogElement | null = $state(null);
	let isClosing = $state(false);

	const ANIMATION_DURATION = 200; // ms - keep in sync with CSS

	function openFullscreen() {
		dialogRef?.showModal();
	}

	function closeFullscreen() {
		if (!dialogRef || isClosing) return;

		// Add closing class to trigger exit animation
		isClosing = true;

		// Wait for animation to complete before actually closing
		setTimeout(() => {
			dialogRef?.close();
			isClosing = false;
		}, ANIMATION_DURATION);
	}

	function handleDialogClose() {
		// Remove focus from the button that triggered the dialog
		// to prevent the blue focus outline on the chart container
		// This handles all close methods: button click, Escape key, backdrop click
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
	}

	function handleBackdropClick(event: MouseEvent) {
		// Close if clicking the dialog backdrop (not the content)
		if (event.target === dialogRef) {
			closeFullscreen();
		}
	}
</script>

<!-- Normal view -->
<div class="mb-6">
	{#if controls}
		<div class="mb-4">
			{@render controls()}
		</div>
	{/if}
	<div
		class="relative rounded-lg border-2 border-tan p-1"
		style="background-color: var(--color-chart-frame)"
	>
		<!-- Expand button -->
		<button
			onclick={openFullscreen}
			class="bg-black/20 hover:bg-black/40 absolute right-3 top-3 z-10 cursor-pointer rounded p-1.5 transition-colors focus:outline-none"
			aria-label="Expand {title} to fullscreen"
			title="Expand to fullscreen"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4 text-white"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
				/>
			</svg>
		</button>

		<Chart {option} {height} />
	</div>
</div>

<!-- Fullscreen dialog (renders in browser's top layer) -->
<dialog
	bind:this={dialogRef}
	onclick={handleBackdropClick}
	onclose={handleDialogClose}
	class="fullscreen-dialog {isClosing ? 'closing' : ''}"
>
	<div class="dialog-content">
		<!-- Close button -->
		<button
			onclick={closeFullscreen}
			class="bg-black/30 hover:bg-black/50 absolute right-0 top-0 z-10 cursor-pointer rounded p-2 transition-colors focus:outline-none"
			aria-label="Close fullscreen"
			title="Close fullscreen (Esc)"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-5 w-5 text-white"
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

		{#if controls}
			<div class="bg-black/90 mb-4 flex-shrink-0 rounded-lg px-4 py-3">
				{@render controls()}
			</div>
		{/if}
		<div
			class="min-h-0 flex-1 rounded-lg p-1"
			style="background-color: var(--color-chart-frame)"
		>
			<Chart {option} height="100%" />
		</div>
	</div>
</dialog>

<style>
	.fullscreen-dialog {
		/* Reset default dialog styles */
		border: none;
		padding: 0;
		background: transparent;
		max-width: none;
		max-height: none;
		width: 100vw;
		height: 100vh;
		/* Remove focus outline - dialog doesn't need visual focus indication */
		outline: none;
	}

	/* Explicitly set display based on open state to fix WebKitGTK compositor issue.
     Without this, the unconditional display:flex overrides the browser's default
     display:none for closed dialogs, causing compositor layer leakage on Linux.
     See: https://github.com/anthropics/per-ankh/issues/8 */
	.fullscreen-dialog:not([open]) {
		display: none;
	}

	.fullscreen-dialog[open] {
		display: flex;
		align-items: center;
		justify-content: center;
		/* Opening animation */
		animation: dialogFadeIn 0.2s ease-out;
	}

	.fullscreen-dialog[open] .dialog-content {
		animation: dialogZoomIn 0.2s ease-out;
	}

	.fullscreen-dialog[open]::backdrop {
		animation: backdropFadeIn 0.2s ease-out;
	}

	/* Closing animation */
	.fullscreen-dialog.closing {
		animation: dialogFadeOut 0.2s ease-in forwards;
	}

	.fullscreen-dialog.closing .dialog-content {
		animation: dialogZoomOut 0.2s ease-in forwards;
	}

	.fullscreen-dialog.closing::backdrop {
		animation: backdropFadeOut 0.2s ease-in forwards;
	}

	@keyframes dialogFadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes dialogFadeOut {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}

	@keyframes dialogZoomIn {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	@keyframes dialogZoomOut {
		from {
			opacity: 1;
			transform: scale(1);
		}
		to {
			opacity: 0;
			transform: scale(0.95);
		}
	}

	@keyframes backdropFadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes backdropFadeOut {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}

	.fullscreen-dialog::backdrop {
		background: rgba(0, 0, 0, 0.8);
	}

	.dialog-content {
		position: relative;
		width: 95vw;
		height: 90vh;
		max-width: 95vw;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		border: 2px solid var(--color-tan);
		border-radius: 0.5rem;
		padding: 1rem;
		background-color: #35302b;
	}
</style>
