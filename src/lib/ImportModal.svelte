<script lang="ts">
	import { Progress } from "bits-ui";
	import type { ImportProgress } from "$lib/types/ImportProgress";
	import type { BatchImportResult } from "$lib/types/BatchImportResult";
	import HieroglyphParade from "./HieroglyphParade.svelte";

	interface Props {
		isOpen: boolean;
		progress: ImportProgress | null;
		result: BatchImportResult | null;
		onClose: () => void;
		onImportComplete?: () => void;
	}

	let {
		isOpen = $bindable(),
		progress,
		result,
		onClose,
		onImportComplete,
	}: Props = $props();

	let isImporting = $derived(result === null);
	let error: string | null = $state(null);

	const progressPercentage = $derived.by(() => {
		if (!progress) return 0;
		const p = progress as ImportProgress;

		// Calculate progress including in-file progress
		// Matches backend logic: completed files + current file progress
		const completedFiles = p.current - 1;
		const currentFileProgress = p.file_progress ?? 0;
		const totalProgress = (completedFiles + currentFileProgress) / p.total;

		return Math.round(totalProgress * 100);
	});

	const formatTime = (ms: number): string => {
		const seconds = Math.floor(ms / 1000);
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		return `${minutes}m ${remainingSeconds}s`;
	};

	function handleClose() {
		if (!isImporting) {
			error = null;

			// If there were successful imports, reload the page to show them
			// Do this BEFORE calling onClose() so the page reloads with the modal still visible
			if (result && result.successful > 0 && onImportComplete) {
				onImportComplete();
			}

			onClose();
		}
	}
</script>

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
	>
		<div
			class="relative mx-4 w-full max-w-2xl overflow-hidden rounded-lg border-2 border-black bg-blue-gray p-6 pt-[4.5rem] shadow-lg"
		>
			<!-- Hieroglyph parade runs across top of modal until closed -->
			<HieroglyphParade active={isOpen} />

			<h2
				class="mb-4 mt-8 border-b-2 border-orange pb-2 text-2xl font-bold text-tan"
			>
				Import Save Files
			</h2>

			{#if result}
				<!-- Complete state: Show results -->
				<div class="space-y-4">
					<div class="text-tan">
						<div class="mb-3 text-lg font-semibold">Import Complete!</div>

						<div class="mb-4 grid grid-cols-3 gap-4">
							<div
								class="rounded border border-black bg-green-900 p-3 text-center"
							>
								<div class="text-2xl font-bold">{result.successful}</div>
								<div class="text-sm text-gray-300">Imported</div>
							</div>
							<div
								class="bg-yellow-900 rounded border border-black p-3 text-center"
							>
								<div class="text-2xl font-bold">{result.skipped}</div>
								<div class="text-sm text-gray-300">Skipped</div>
							</div>
							<div
								class="rounded border border-black bg-red-900 p-3 text-center"
							>
								<div class="text-2xl font-bold">{result.failed}</div>
								<div class="text-sm text-gray-300">Failed</div>
							</div>
						</div>

						<div class="mb-4 text-sm text-gray-400">
							Total time: {formatTime(result.duration_ms)}
						</div>

						{#if result.errors.length > 0}
							<div class="mt-4">
								<div class="mb-2 font-semibold">Errors:</div>
								<div
									class="max-h-40 overflow-y-auto rounded border border-red-700 bg-gray-800 p-3"
								>
									{#each result.errors as error (error.file_name)}
										<div class="mb-2 text-sm">
											<div class="font-semibold text-red-400">
												{error.file_name}
											</div>
											<div class="ml-2 text-gray-400">{error.error}</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}
					</div>

					<button
						class="hover:bg-brown-dark w-full rounded border-2 border-black bg-brown px-4 py-2 font-semibold text-tan transition-colors"
						type="button"
						onclick={handleClose}
					>
						Done
					</button>
				</div>
			{:else if progress}
				<!-- Importing state: Show progress -->
				<div class="space-y-4">
					<div class="text-tan">
						<div class="mb-2 flex justify-between">
							<span class="font-semibold">Progress:</span>
							<span>{progress.current} of {progress.total} files</span>
						</div>

						<!-- Progress bar -->
						<div class="mb-4 w-full">
							<Progress.Root
								value={progressPercentage}
								max={100}
								class="relative h-6 w-full overflow-hidden rounded-full border border-black bg-gray-700"
							>
								<div
									class="absolute inset-0 flex items-center justify-center bg-orange text-sm font-bold text-black transition-all duration-300"
									style="width: {progressPercentage}%; max-width: 100%;"
								>
									{progressPercentage}%
								</div>
							</Progress.Root>
						</div>

						<!-- Current file -->
						<div class="mb-3">
							<span class="font-semibold">Current file:</span>
							<div
								class="mt-1 truncate text-sm text-gray-300"
								title={progress.current_file}
							>
								{progress.current_file}
							</div>
						</div>

						<!-- Current phase - always reserve space to prevent layout shift -->
						<div class="mb-3 h-5">
							<span class="text-tan-dark text-sm italic">
								{progress.current_phase ?? "\u00A0"}
							</span>
						</div>

						<!-- Stats -->
						<div class="grid grid-cols-2 gap-4 text-sm">
							<div>
								<span class="text-gray-400">Elapsed:</span>
								<span class="ml-2 text-tan"
									>{formatTime(progress.elapsed_ms)}</span
								>
							</div>
							<div>
								<span class="text-gray-400">Remaining:</span>
								<span class="ml-2 text-tan"
									>{formatTime(progress.estimated_remaining_ms)}</span
								>
							</div>
						</div>
					</div>
				</div>
			{:else}
				<!-- Importing state: Show generic loading message -->
				<div class="space-y-4">
					<div class="py-8 text-center text-tan">
						<div class="mb-4 text-xl font-semibold">Importing...</div>
						<div class="text-gray-400">
							Please wait while files are being imported.
						</div>
						<div class="mt-2 text-sm text-gray-400">
							This may take a minute or two.
						</div>
					</div>
				</div>
			{/if}

			{#if error}
				<div class="mt-4 rounded border border-red-700 bg-red-900 p-3 text-tan">
					<div class="font-semibold">Error:</div>
					<div class="mt-1 text-sm">{error}</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
