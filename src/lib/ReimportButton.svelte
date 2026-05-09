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
	import { cloudApi, ApiError, UnauthorizedError } from "$lib/api-cloud";

	let { gameId }: { gameId: string } = $props();

	type State =
		| { kind: "idle" }
		| { kind: "downloading" }
		| { kind: "modal"; rawZip: ArrayBuffer; fileName: string }
		| { kind: "error"; message: string };

	let state = $state<State>({ kind: "idle" });

	async function startReimport() {
		state = { kind: "downloading" };
		try {
			const { blob, filename } = await cloudApi.downloadGame(gameId);
			const rawZip = await blob.arrayBuffer();
			state = { kind: "modal", rawZip, fileName: filename };
		} catch (err) {
			if (err instanceof UnauthorizedError) {
				state = {
					kind: "error",
					message: "Session expired — please log in again.",
				};
				return;
			}
			if (err instanceof ApiError && err.status === 429) {
				state = {
					kind: "error",
					message: "Too many downloads. Try again in an hour.",
				};
				return;
			}
			state = {
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
		state = { kind: "idle" };
	}

	function dismiss() {
		state = { kind: "idle" };
	}
</script>

{#if state.kind === "idle"}
	<button
		type="button"
		onclick={startReimport}
		class="rounded bg-orange px-3 py-1 text-xs font-bold text-white hover:bg-orange/80"
	>
		Reparse
	</button>
{:else if state.kind === "downloading"}
	<button
		type="button"
		disabled
		class="rounded bg-brown px-3 py-1 text-xs text-tan opacity-50"
	>
		Fetching save…
	</button>
{:else if state.kind === "error"}
	<div class="flex items-center gap-2">
		<span class="text-xs text-orange">{state.message}</span>
		<button
			type="button"
			onclick={dismiss}
			class="rounded bg-brown px-2 py-1 text-xs text-tan hover:bg-orange"
		>
			Dismiss
		</button>
	</div>
{/if}

{#if state.kind === "modal"}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
		role="dialog"
		aria-modal="true"
		aria-label="Re-import game"
	>
		<div class="w-full max-w-lg">
			<UploadModal
				prefilled={{ rawZip: state.rawZip, fileName: state.fileName }}
				onDone={onModalDone}
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
