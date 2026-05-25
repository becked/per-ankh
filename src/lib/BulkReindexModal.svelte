<script lang="ts">
	// Bulk reindex — sweep every game and rebuild its derived D1 tables from
	// the stored R2 blob. Unlike BulkReparseModal there's no download/parse:
	// each game is a single POST to the admin reindex endpoint, which reads
	// the blob and re-runs the database pivot server-side. Sequential, one
	// game at a time, so a large sweep stays well within Worker limits and
	// the progress list is easy to follow.

	import { cloudApi, ApiError, type AdminGameIdListItem } from "$lib/api-cloud";
	import HieroglyphParade from "$lib/HieroglyphParade.svelte";

	type RowStatus =
		| { kind: "queued" }
		| { kind: "reindexing" }
		| { kind: "done" }
		| { kind: "error"; message: string };

	interface Row {
		gameId: string;
		gameName: string;
		status: RowStatus;
	}

	let {
		games,
		onClose,
	}: {
		games: AdminGameIdListItem[];
		// eslint-disable-next-line no-unused-vars -- callback type parameter name is documentation
		onClose: (didReindex: boolean) => void;
	} = $props();

	type Phase = "idle" | "running" | "done";

	let phase = $state<Phase>("idle");
	// Snapshot of the games at modal-open time. The prop is effectively
	// immutable for the modal's lifetime ({#if reindexOpen} remounts on each
	// open), so capturing once is intentional.
	// svelte-ignore state_referenced_locally
	let rows = $state<Row[]>(
		games.map((g) => ({
			gameId: g.game_id,
			gameName: g.game_name ?? "Unnamed game",
			status: { kind: "queued" },
		})),
	);
	let cancelled = false;

	const summary = $derived.by(() => {
		let done = 0;
		let failed = 0;
		for (const r of rows) {
			if (r.status.kind === "done") done++;
			else if (r.status.kind === "error") failed++;
		}
		return { done, failed };
	});

	function setStatus(gameId: string, status: RowStatus) {
		const r = rows.find((row) => row.gameId === gameId);
		if (r) r.status = status;
	}

	async function processOne(row: Row): Promise<void> {
		setStatus(row.gameId, { kind: "reindexing" });
		try {
			await cloudApi.adminReindexGame(row.gameId);
			setStatus(row.gameId, { kind: "done" });
		} catch (err) {
			const message =
				err instanceof ApiError
					? `${err.code ?? err.status}: ${err.message}`
					: err instanceof Error
						? err.message
						: "Reindex failed";
			setStatus(row.gameId, { kind: "error", message });
		}
	}

	async function start() {
		if (phase !== "idle") return;
		phase = "running";
		for (const row of rows) {
			if (cancelled) break;
			await processOne(row);
		}
		phase = "done";
	}

	function cancel() {
		cancelled = true;
		phase = "done";
	}

	function close() {
		const didReindex = summary.done > 0;
		onClose(didReindex);
	}
</script>

<div
	class="bg-black/70 fixed inset-0 z-50 flex items-center justify-center p-4"
	role="dialog"
	aria-modal="true"
	aria-label="Reindex all games"
>
	<div class="w-full max-w-2xl rounded border-2 border-black bg-[#2a2622] p-6">
		<HieroglyphParade active={phase === "running"} />
		<div class="mb-4 mt-4 flex items-center justify-between">
			<h2 class="font-serif text-xl text-tan">
				Reindex {rows.length} game{rows.length === 1 ? "" : "s"}
			</h2>
			{#if phase === "idle"}
				<button
					type="button"
					onclick={close}
					class="text-xs text-tan underline hover:text-orange"
				>
					Cancel
				</button>
			{/if}
		</div>

		{#if phase === "idle"}
			<p class="mb-4 text-sm text-tan">
				Rebuilds each game's derived database tables from its stored blob in the
				Worker. No re-parse, no re-upload — game IDs, visibility, and all other
				game-row settings are preserved.
			</p>
			<div class="flex gap-2">
				<button
					type="button"
					onclick={start}
					class="hover:bg-orange/80 rounded bg-orange px-4 py-2 text-sm font-bold text-white"
				>
					Start reindexing
				</button>
				<button
					type="button"
					onclick={close}
					class="rounded bg-brown px-4 py-2 text-sm text-tan hover:bg-orange"
				>
					Cancel
				</button>
			</div>
		{:else}
			<div class="mb-4 text-sm text-tan">
				{summary.done} done · {summary.failed} failed
			</div>
			<ul class="max-h-96 space-y-1 overflow-y-auto pr-2">
				{#each rows as row (row.gameId)}
					<li
						class="flex items-center gap-2 rounded bg-[#1f1c19] px-2 py-1 text-xs"
					>
						<span class="flex-1 truncate text-tan">{row.gameName}</span>
						<span class="text-right">
							{#if row.status.kind === "queued"}
								<span class="text-brown">Queued</span>
							{:else if row.status.kind === "reindexing"}
								<span class="text-tan">Reindexing…</span>
							{:else if row.status.kind === "done"}
								<span class="font-bold text-green-500">Reindexed</span>
							{:else if row.status.kind === "error"}
								<span class="text-orange" title={row.status.message}>
									Failed
								</span>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
			<div class="mt-4 flex gap-2">
				{#if phase === "running"}
					<button
						type="button"
						onclick={cancel}
						class="rounded bg-brown px-4 py-2 text-sm text-tan hover:bg-orange"
					>
						Stop
					</button>
				{:else}
					<button
						type="button"
						onclick={close}
						class="hover:bg-orange/80 rounded bg-orange px-4 py-2 text-sm font-bold text-white"
					>
						Close
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>
