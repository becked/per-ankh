<script lang="ts">
	// The map view's turn and layer controls, in the chrome: the Political and
	// Units layer toggles, and the turn slider with play and fast-forward. The
	// map page owns the turn and the layers; SpriteMap only draws them.
	import Checkbox from "$lib/ui/Checkbox.svelte";

	let {
		totalTurns,
		selectedTurn,
		onTurnChange,
		showPolitical = $bindable(true),
		showUnits = $bindable(true),
	}: {
		totalTurns: number;
		selectedTurn: number;
		// eslint-disable-next-line no-unused-vars -- Callback type signature
		onTurnChange: (turn: number) => Promise<void> | void;
		showPolitical?: boolean;
		showUnits?: boolean;
	} = $props();

	// Units draw at the final turn only — `UnitInfo` is a snapshot of
	// `<Tile>/<Unit>` and the save carries no position history — so the
	// checkbox is disabled away from it. Derived from the two turns this
	// component already takes rather than from a second input: `MapChrome`
	// feeds `totalTurns` the same `game_details.total_turns` the page feeds
	// `SpriteMap` as `isFinalTurn`, so there is one source of truth for the
	// gate. The CHECKED state survives a scrub either way — the glyphs leave
	// below the final turn and return at it.
	const unitsAvailable = $derived(selectedTurn >= totalTurns);

	// Debounce slider input so a drag rebuilds the turn's tiles and the map's
	// layers once it settles, not on every intermediate value.
	let sliderDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	function handleSliderChange(event: Event) {
		const target = event.target as HTMLInputElement;
		const turn = parseInt(target.value, 10);
		if (sliderDebounceTimer) clearTimeout(sliderDebounceTimer);
		sliderDebounceTimer = setTimeout(() => {
			void onTurnChange(turn);
		}, 100);
	}

	let isPlaying = $state(false);
	let isFastPlaying = $state(false);
	let playbackInterval: ReturnType<typeof setInterval> | null = null;
	const PLAYBACK_SPEED_MS = 300;
	const FAST_PLAYBACK_SPEED_MS = 150;

	function startPlayback(fast: boolean) {
		stopPlayback();
		if (selectedTurn >= totalTurns) {
			void onTurnChange(1);
		}
		isPlaying = !fast;
		isFastPlaying = fast;
		const speed = fast ? FAST_PLAYBACK_SPEED_MS : PLAYBACK_SPEED_MS;
		playbackInterval = setInterval(() => {
			if (selectedTurn >= totalTurns) {
				stopPlayback();
			} else {
				void onTurnChange(selectedTurn + 1);
			}
		}, speed);
	}

	function stopPlayback() {
		isPlaying = false;
		isFastPlaying = false;
		if (playbackInterval) {
			clearInterval(playbackInterval);
			playbackInterval = null;
		}
	}

	function togglePlayback() {
		if (isPlaying) stopPlayback();
		else startPlayback(false);
	}

	function toggleFastPlayback() {
		if (isFastPlaying) stopPlayback();
		else startPlayback(true);
	}

	$effect(() => {
		return () => {
			if (playbackInterval) clearInterval(playbackInterval);
			if (sliderDebounceTimer) clearTimeout(sliderDebounceTimer);
		};
	});
</script>

<div class="flex flex-wrap items-center gap-4 text-[11px]">
	<div class="flex items-center gap-3">
		<Checkbox bind:checked={showPolitical} labelClass="gap-1.5">
			<span class="select-none text-tan">Political</span>
		</Checkbox>
		<Checkbox
			bind:checked={showUnits}
			disabled={!unitsAvailable}
			labelClass="gap-1.5"
		>
			<span
				class="select-none text-tan"
				title={unitsAvailable
					? undefined
					: `Units are recorded only at turn ${totalTurns}, the end of the game.`}
				>Units</span
			>
		</Checkbox>
	</div>

	<div class="ml-auto flex items-center gap-6">
		<div class="flex items-center gap-3">
			<span class="text-[11px] font-bold text-tan">Turn:</span>
			<div class="flex items-center">
				<button
					onclick={togglePlayback}
					class="rounded p-1 transition-colors {isPlaying
						? 'bg-brown text-tan'
						: 'bg-brown/30 hover:bg-brown/50'}"
					aria-label={isPlaying ? "Pause" : "Play"}
					title={isPlaying ? "Pause" : "Play (1x)"}
				>
					{#if isPlaying}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-3 w-3 text-tan"
							fill="currentColor"
							viewBox="0 0 24 24"
						>
							<rect x="6" y="4" width="4" height="16" />
							<rect x="14" y="4" width="4" height="16" />
						</svg>
					{:else}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-3 w-3 text-tan"
							fill="currentColor"
							viewBox="0 0 24 24"
						>
							<path d="M8 5v14l11-7z" />
						</svg>
					{/if}
				</button>
				<button
					onclick={toggleFastPlayback}
					class="rounded p-1 transition-colors {isFastPlaying
						? 'bg-brown text-tan'
						: 'bg-brown/30 hover:bg-brown/50'}"
					aria-label={isFastPlaying ? "Pause" : "Fast Forward"}
					title={isFastPlaying ? "Pause" : "Fast Forward (2x)"}
				>
					{#if isFastPlaying}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-3 w-3 text-tan"
							fill="currentColor"
							viewBox="0 0 24 24"
						>
							<rect x="6" y="4" width="4" height="16" />
							<rect x="14" y="4" width="4" height="16" />
						</svg>
					{:else}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-3 w-3 text-tan"
							fill="currentColor"
							viewBox="0 0 24 24"
						>
							<path d="M4 5v14l8-7z" />
							<path d="M12 5v14l8-7z" />
						</svg>
					{/if}
				</button>
			</div>
			<input
				type="range"
				min="1"
				max={totalTurns}
				value={selectedTurn}
				oninput={handleSliderChange}
				class="turn-slider w-48"
			/>
			<span class="w-8 text-right text-[11px] font-bold text-tan"
				>{selectedTurn}</span
			>
		</div>
	</div>
</div>

<style>
	.turn-slider {
		-webkit-appearance: none;
		appearance: none;
		height: 6px;
		background: rgb(var(--color-track));
		border-radius: 3px;
		outline: none;
		cursor: pointer;
	}

	.turn-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 16px;
		height: 16px;
		background: rgb(var(--color-brown));
		border-radius: 50%;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.turn-slider::-webkit-slider-thumb:hover {
		background: rgb(var(--color-tan));
	}

	.turn-slider::-moz-range-thumb {
		width: 16px;
		height: 16px;
		background: rgb(var(--color-brown));
		border-radius: 50%;
		cursor: pointer;
		border: none;
		transition: background 0.15s ease;
	}

	.turn-slider::-moz-range-thumb:hover {
		background: rgb(var(--color-tan));
	}
</style>
