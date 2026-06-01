<script lang="ts">
	// Owner-only re-import action shown on the game detail page when the
	// stored parser_version is older than the current PARSER_VERSION
	// constant. Mounts UploadModal with the downloaded ZIP pre-filled,
	// skipping the file-picker step. The Worker recognizes the
	// (user_id, file_hash) collision + newer parser_version as an
	// in-place overwrite (see cloud/src/games.ts handleGameUpload), so
	// from the client's perspective this is just a normal upload that
	// happens to land on an existing game_id.

	import { invalidateAll } from "$app/navigation";
	import UploadModal from "$lib/UploadModal.svelte";
	import HieroglyphParade from "$lib/HieroglyphParade.svelte";
	import { cloudApi, ApiError, UnauthorizedError } from "$lib/api-cloud";

	let { gameId }: { gameId: string } = $props();

	type Status =
		| { kind: "idle" }
		| { kind: "downloading" }
		| { kind: "modal"; rawZip: ArrayBuffer; fileName: string }
		| { kind: "error"; message: string };

	let status = $state<Status>({ kind: "idle" });
	let paradeActive = $state(false);

	async function startReimport() {
		status = { kind: "downloading" };
		try {
			const { blob, filename } = await cloudApi.downloadGame(gameId);
			const rawZip = await blob.arrayBuffer();
			status = { kind: "modal", rawZip, fileName: filename };
		} catch (err) {
			if (err instanceof UnauthorizedError) {
				status = {
					kind: "error",
					message: "Session expired — please log in again.",
				};
				return;
			}
			if (err instanceof ApiError && err.status === 429) {
				status = {
					kind: "error",
					message: "Too many downloads. Try again in an hour.",
				};
				return;
			}
			status = {
				kind: "error",
				message: err instanceof Error ? err.message : String(err),
			};
		}
	}

	async function onModalDone(_id: string, info: { reimported: boolean }) {
		// Whether the Worker took the re-import branch or returned a 201
		// (shouldn't happen for re-import — the file_hash always collides),
		// re-run the page load so the banner re-evaluates against the
		// refreshed parser_version. invalidateAll() re-runs the route's
		// load() but keeps the URL stable.
		void info;
		await invalidateAll();
		status = { kind: "idle" };
	}

	function dismiss() {
		status = { kind: "idle" };
	}
</script>

{#if status.kind === "idle"}
	<button
		type="button"
		onclick={startReimport}
		class="rounded bg-orange px-3 py-1 text-xs font-bold text-white hover:bg-orange/80"
	>
		Reparse
	</button>
{:else if status.kind === "downloading"}
	<button
		type="button"
		disabled
		class="rounded bg-brown px-3 py-1 text-xs text-tan opacity-50"
	>
		Fetching save…
	</button>
{:else if status.kind === "error"}
	<div class="flex items-center gap-2">
		<span class="text-xs text-orange">{status.message}</span>
		<button
			type="button"
			onclick={dismiss}
			class="rounded bg-brown px-2 py-1 text-xs text-tan hover:bg-orange"
		>
			Dismiss
		</button>
	</div>
{/if}

{#if status.kind === "modal"}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
		role="dialog"
		aria-modal="true"
		aria-label="Re-import game"
	>
		<div class="w-full max-w-lg rounded border-2 border-black bg-surface p-6">
			<HieroglyphParade active={paradeActive} />
			<UploadModal
				prefilled={{ rawZip: status.rawZip, fileName: status.fileName }}
				onDone={onModalDone}
				onBusyChange={(busy) => (paradeActive = busy)}
			/>
			<div class="mt-2 text-right">
				<button
					type="button"
					onclick={dismiss}
					class="text-xs text-tan underline hover:text-orange"
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
