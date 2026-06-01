<script lang="ts">
	import { onDestroy, untrack } from "svelte";

	interface Props {
		active?: boolean;
	}

	let { active = true }: Props = $props();

	// Curated hieroglyphs: people, animals, deities, and interesting figures
	// from Unicode block U+13000-U+1342F (Egyptian Hieroglyphs).
	const HIEROGLYPHS = [
		// People and figures
		"\u{13000}",
		"\u{13001}",
		"\u{13002}",
		"\u{13003}",
		"\u{13004}",
		"\u{13005}",
		"\u{13006}",
		"\u{13007}",
		"\u{1300D}",
		"\u{13010}",
		"\u{13014}",
		"\u{1301F}",
		// Women
		"\u{13026}",
		"\u{13027}",
		"\u{13028}",
		// Deities and crowned figures
		"\u{13040}",
		"\u{13041}",
		"\u{13042}",
		"\u{13050}",
		// Birds
		"\u{13170}",
		"\u{13171}",
		"\u{13183}",
		"\u{1317D}",
		"\u{1317E}",
		"\u{13184}",
		"\u{13185}",
		"\u{1319D}",
		// Animals
		"\u{130ED}",
		"\u{130F2}",
		"\u{130FF}",
		"\u{13100}",
		"\u{13102}",
		"\u{13103}",
		"\u{130A4}",
		"\u{130A5}",
		"\u{130A7}",
		"\u{13153}",
		"\u{1312D}",
		"\u{1312F}",
		"\u{13123}",
		// Snakes
		"\u{13193}",
		"\u{13194}",
		// Fish
		"\u{131B5}",
		"\u{131BC}",
	];

	const PARADE_DURATION_MS = 20000;
	const SPAWN_INTERVAL_MS = 600;

	// Static border = a long string of one glyph clipped to band width by
	// overflow:hidden. Fixed length covers any host up to ~3000px without a
	// bare zone on the right; cheaper and more reliable than measuring the
	// actual rendered glyph width (which varies by font/zoom/DPI).
	const BORDER_GLYPH_CHAR = "\u{13129}";
	const BORDER_GLYPHS = BORDER_GLYPH_CHAR.repeat(500);

	// Static glyphs in the parade row when paused. Count scales with band
	// width but the items are positioned by flex justify-content rather than
	// pixel offsets, so they always span the full band even if the measured
	// width and the actual render disagree.
	const STATIC_SPACING_PX = 28;
	const STATIC_MIN_COUNT = 8;

	interface ParadeItem {
		id: number;
		char: string;
		spawnTime: number;
		animationDelay: number;
	}

	interface StaticItem {
		id: number;
		char: string;
	}

	let items = $state<ParadeItem[]>([]);
	let staticItems = $state<StaticItem[]>([]);
	let bandWidth = $state(0);
	let nextId = 0;
	let animationFrameId: number | null = null;
	let nextSpawnTime = 0;
	let isRunning = false;
	const removalTimeouts: Array<ReturnType<typeof setTimeout>> = [];

	function prefersReducedMotion(): boolean {
		return (
			typeof window !== "undefined" &&
			window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
		);
	}

	function scheduleRemoval(id: number, animationDelay: number) {
		const remainingDuration = PARADE_DURATION_MS + animationDelay * 1000 + 1000;
		const handle = setTimeout(
			() => {
				const idx = removalTimeouts.indexOf(handle);
				if (idx !== -1) removalTimeouts.splice(idx, 1);
				items = items.filter((i) => i.id !== id);
			},
			Math.max(remainingDuration, 100),
		);
		removalTimeouts.push(handle);
	}

	function spawnHieroglyph(animationDelay: number = 0) {
		const char = HIEROGLYPHS[Math.floor(Math.random() * HIEROGLYPHS.length)];
		const id = nextId++;
		items = [
			...items,
			{ id, char, spawnTime: performance.now(), animationDelay },
		];
		scheduleRemoval(id, animationDelay);
	}

	function animate(currentTime: number) {
		if (!isRunning) return;

		while (currentTime >= nextSpawnTime) {
			const delayMs = currentTime - nextSpawnTime;
			const animationDelay = -delayMs / 1000;
			untrack(() => spawnHieroglyph(animationDelay));
			nextSpawnTime += SPAWN_INTERVAL_MS;
		}

		animationFrameId = requestAnimationFrame(animate);
	}

	function startParade() {
		// Reduced motion: skip the marching layer entirely. The CSS hides
		// .parade-container too, so this is belt-and-suspenders.
		if (prefersReducedMotion()) return;

		nextId = 0;
		isRunning = true;

		const now = performance.now();
		const itemsToPreSpawn = Math.ceil(PARADE_DURATION_MS / SPAWN_INTERVAL_MS);
		const initialItems: ParadeItem[] = [];

		for (let i = 0; i < itemsToPreSpawn; i++) {
			const ageMs = (itemsToPreSpawn - 1 - i) * SPAWN_INTERVAL_MS;
			const animationDelay = -ageMs / 1000;
			const char = HIEROGLYPHS[Math.floor(Math.random() * HIEROGLYPHS.length)];
			const id = nextId++;
			initialItems.push({
				id,
				char,
				spawnTime: now,
				animationDelay,
			});
			scheduleRemoval(id, animationDelay);
		}

		items = initialItems;
		nextSpawnTime = now + SPAWN_INTERVAL_MS;
		animationFrameId = requestAnimationFrame(animate);
	}

	function stopParade() {
		isRunning = false;
		if (animationFrameId !== null) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
		for (const handle of removalTimeouts) clearTimeout(handle);
		removalTimeouts.length = 0;
		items = [];
	}

	function regenerateStaticItems() {
		const count = Math.max(
			STATIC_MIN_COUNT,
			Math.floor((bandWidth || 0) / STATIC_SPACING_PX),
		);
		const next: StaticItem[] = [];
		for (let i = 0; i < count; i++) {
			next.push({
				id: i,
				char: HIEROGLYPHS[Math.floor(Math.random() * HIEROGLYPHS.length)],
			});
		}
		staticItems = next;
	}

	$effect(() => {
		if (active) {
			staticItems = [];
			startParade();
		} else {
			stopParade();
			regenerateStaticItems();
		}
	});

	// When the band resizes while paused, refill the static row to the new
	// width. Skipped while marching since the marching layer doesn't depend
	// on container width.
	$effect(() => {
		if (!active && bandWidth > 0) regenerateStaticItems();
	});

	onDestroy(() => {
		stopParade();
	});
</script>

<div class="parade-band" bind:clientWidth={bandWidth}>
	<div class="hieroglyph-border hieroglyph-border-top">{BORDER_GLYPHS}</div>

	{#if active}
		<div class="parade-container">
			{#each items as item (item.id)}
				<span
					class="parade-item"
					style="animation-delay: {item.animationDelay}s"
				>
					{item.char}
				</span>
			{/each}
		</div>
	{:else}
		<div class="parade-static">
			{#each staticItems as item (item.id)}
				<span class="parade-item static">{item.char}</span>
			{/each}
		</div>
	{/if}

	<div class="hieroglyph-border hieroglyph-border-bottom">{BORDER_GLYPHS}</div>
</div>

<style>
	.parade-band {
		position: relative;
		width: 100%;
		height: 3.6rem;
		overflow: hidden;
		font-family:
			"Noto Sans Egyptian Hieroglyphs", "Apple Symbols", "Segoe UI Historic",
			"Aegyptus", system-ui, sans-serif;
	}

	.parade-container {
		position: absolute;
		top: 0.6rem;
		left: 0;
		right: 0;
		height: 2.4rem;
		overflow: hidden;
		pointer-events: none;
		display: flex;
		align-items: center;
		-webkit-mask-image: linear-gradient(
			to right,
			transparent 0,
			black 1rem,
			black calc(100% - 1rem),
			transparent 100%
		);
		mask-image: linear-gradient(
			to right,
			transparent 0,
			black 1rem,
			black calc(100% - 1rem),
			transparent 100%
		);
	}

	.parade-item {
		position: absolute;
		font-size: 1.2rem;
		color: rgb(var(--color-tan));
		opacity: 0.9;
		animation: parade-march 20s linear forwards;
		right: -2.4rem;
		white-space: nowrap;
		line-height: 1;
	}

	.parade-static {
		position: absolute;
		top: 0.6rem;
		left: 0;
		right: 0;
		height: 2.4rem;
		display: flex;
		align-items: center;
		justify-content: space-evenly;
		pointer-events: none;
	}

	.parade-item.static {
		position: static;
		animation: none;
	}

	@keyframes parade-march {
		0% {
			transform: translateX(0);
		}
		100% {
			transform: translateX(calc(-100vw - 4.8rem));
		}
	}

	.hieroglyph-border {
		position: absolute;
		left: 0;
		right: 0;
		font-size: 0.5rem;
		color: rgb(var(--color-tan));
		opacity: 0.7;
		white-space: nowrap;
		overflow: hidden;
		pointer-events: none;
		letter-spacing: 0.15em;
		line-height: 1;
	}

	.hieroglyph-border-top {
		top: 0.05rem;
	}

	.hieroglyph-border-bottom {
		bottom: 0.05rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.parade-container {
			display: none;
		}
	}
</style>
