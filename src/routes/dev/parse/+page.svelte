<script lang="ts">
	import ParserWorker from "$lib/parser/worker?worker";
	import type { FullGameData } from "$lib/parser/types";
	import type { MapTile } from "$lib/types/MapTile";
	import type { WorkerMessage } from "$lib/parser/worker";
	import { GameDetailView } from "$lib/game-detail";
	import { reconstructMapTiles } from "$lib/game-detail/reconstruct-map-tiles";

	type Status =
		| { kind: "idle" }
		| { kind: "parsing"; phase: string; percent: number }
		| { kind: "done"; data: FullGameData; fileName: string }
		| { kind: "error"; code: string; message: string };

	let status = $state<Status>({ kind: "idle" });
	let worker: Worker | null = null;

	// Map-slider state. Re-initialised whenever a new save is loaded.
	let selectedMapTurn = $state<number | null>(null);
	let mapTiles = $state<MapTile[]>([]);

	$effect(() => {
		if (status.kind === "done") {
			selectedMapTurn = status.data.game_details.total_turns;
			mapTiles = status.data.map_tiles;
		}
	});

	async function handleMapTurnChange(turn: number) {
		if (status.kind !== "done") return;
		selectedMapTurn = turn;
		mapTiles = reconstructMapTiles(status.data, turn);
	}

	function reset() {
		worker?.terminate();
		worker = null;
		status = { kind: "idle" };
	}

	async function onPick(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		input.value = "";

		const buffer = await file.arrayBuffer();
		status = { kind: "parsing", phase: "Starting", percent: 0 };

		worker?.terminate();
		worker = new ParserWorker();
		worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
			const msg = ev.data;
			if (msg.type === "progress") {
				status = {
					kind: "parsing",
					phase: msg.phase,
					percent: msg.percent,
				};
			} else if (msg.type === "result") {
				status = { kind: "done", data: msg.data, fileName: file.name };
				worker?.terminate();
				worker = null;
			} else {
				status = { kind: "error", code: msg.code, message: msg.message };
				worker?.terminate();
				worker = null;
			}
		};
		worker.postMessage(
			{ type: "parse", file: buffer, fileName: file.name },
			{ transfer: [buffer] },
		);
	}
</script>

<svelte:head>
	<title>Dev — Browser Parser MVP</title>
</svelte:head>

<main class="isolate flex-1 overflow-y-auto bg-blue-gray px-4 pb-8 pt-4">
	<div class="mb-4 rounded bg-[#2a2622] px-4 py-2 text-xs text-brown">
		<strong>/dev/parse</strong> — browser parser vertical-slice MVP.
		Pick a save zip; it parses in a Web Worker and renders via
		<code>GameDetailView</code>.
	</div>

	{#if status.kind === "idle"}
		<div class="rounded border-2 border-brown bg-[#2a2622] p-6">
			<label class="block">
				<span class="mb-2 block text-sm font-bold text-tan">
					Pick a save zip
				</span>
				<input
					type="file"
					accept=".zip"
					onchange={onPick}
					class="block w-full text-sm text-tan file:mr-4 file:rounded file:border-0 file:bg-brown file:px-4 file:py-2 file:text-sm file:font-bold file:text-tan hover:file:bg-orange"
				/>
			</label>
		</div>
	{:else if status.kind === "parsing"}
		<div class="rounded border-2 border-brown bg-[#2a2622] p-6">
			<p class="mb-2 text-sm text-tan">
				{status.phase} — {status.percent}%
			</p>
			<progress
				value={status.percent}
				max={100}
				class="w-full"
			></progress>
		</div>
	{:else if status.kind === "error"}
		<div class="rounded border-2 border-orange bg-brown p-6 text-white">
			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-lg font-bold">Parse error</h2>
				<button
					type="button"
					onclick={reset}
					class="rounded bg-[#2a2622] px-3 py-1 text-sm hover:bg-black"
				>
					Try another file
				</button>
			</div>
			<p class="mb-2 font-mono text-sm font-bold">{status.code}</p>
			<p class="text-sm">{status.message}</p>
		</div>
	{:else}
		<div class="mb-4 flex items-center justify-between rounded bg-[#2a2622] px-4 py-2">
			<span class="text-sm text-brown">
				Loaded: <code>{status.fileName}</code>
			</span>
			<button
				type="button"
				onclick={reset}
				class="rounded bg-brown px-3 py-1 text-sm font-bold text-tan hover:bg-orange"
			>
				Load another save
			</button>
		</div>
		<GameDetailView
			gameDetails={status.data.game_details}
			playerHistory={status.data.player_history}
			allYields={status.data.yield_history}
			eventLogs={status.data.event_logs}
			lawAdoptionHistory={status.data.law_adoption_history}
			currentLaws={status.data.current_laws}
			techDiscoveryHistory={status.data.tech_discovery_history}
			completedTechs={status.data.completed_techs}
			unitsProduced={status.data.units_produced}
			cityStatistics={status.data.city_statistics}
			improvementData={status.data.improvement_data}
			gameReligions={status.data.game_religions}
			playerWonders={status.data.player_wonders}
			{mapTiles}
			{selectedMapTurn}
			onMapTurnChange={handleMapTurnChange}
		/>
	{/if}
</main>
