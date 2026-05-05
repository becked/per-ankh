<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import type { PageData } from "./$types";
	import type { MapTile } from "$lib/types/MapTile";
	import { GameDetailView } from "$lib/game-detail";
	import { reconstructMapTiles } from "$lib/game-detail/reconstruct-map-tiles";
	import {
		cloudApi,
		ApiError,
		UnauthorizedError,
	} from "$lib/api-cloud";
	import { formatEnum } from "$lib/utils/formatting";
	import { isNewer } from "$lib/utils/semver";
	import { PARSER_VERSION } from "$lib/parser/types";
	import VisibilityToggle from "$lib/VisibilityToggle.svelte";
	import ReimportButton from "$lib/ReimportButton.svelte";

	let { data }: { data: PageData } = $props();
	const game = $derived(data.game);
	const isOwner = $derived(data.isOwner);
	// Cloud game id from URL — distinct from the in-game `xml_game_id`
	// which is the GameId attribute on the save's <Root> element.
	const gameId = $derived(page.params.id ?? "");

	// OG tags for Discord/Slack/Twitter unfurls. Composed from server-known
	// match metadata only — no PII concerns; same data anonymous viewers
	// already see in the page body.
	const PUBLIC_ORIGIN = (
		import.meta.env.VITE_PUBLIC_ORIGIN ?? "https://per-ankh.app"
	) as string;
	const ogTitle = $derived(game.game_details.game_name ?? "Old World game");
	const ogDescription = $derived(
		(() => {
			const gd = game.game_details;
			const parts: string[] = [];
			if (gd.winner_civilization) {
				parts.push(formatEnum(gd.winner_civilization, "NATION_"));
			} else if (gd.winner_name) {
				parts.push(gd.winner_name);
			}
			if (gd.winner_victory_type) {
				const v = formatEnum(gd.winner_victory_type, "VICTORY_");
				parts.push(`won by ${v}`);
			}
			parts.push(`turn ${gd.total_turns}`);
			return parts.length > 0
				? parts.join(", ")
				: "An Old World save game on Per-Ankh.";
		})(),
	);
	const ogUrl = $derived(`${PUBLIC_ORIGIN}/games/${gameId}`);
	const ogImage = $derived(`${PUBLIC_ORIGIN}/og-default.png`);

	let selectedMapTurn = $state<number | null>(null);
	let mapTiles = $state<MapTile[]>([]);
	let deleting = $state(false);
	let downloading = $state(false);
	// Visibility toggle state — read from the server-injected `is_public`
	// field on owner responses. Initialise at component construction (not in
	// $effect) so the SSR'd HTML renders the correct toggle position;
	// $effect doesn't run during SSR. The $effect below re-syncs on
	// client-side navigation between games. Public viewers don't see the
	// toggle.
	// svelte-ignore state_referenced_locally
	let isPublic = $state(
		(data.game as { is_public?: boolean }).is_public ?? false,
	);

	// Re-import banner: shown to owners when the stored parser_version is
	// older than the current build's PARSER_VERSION. The blob carries
	// parser_version through from the gzipped JSON in R2, so this works
	// without a separate API call. Hidden for anonymous viewers (public
	// games) and non-owner signed-in viewers (`isOwner` is false in both).
	const isReimportAvailable = $derived(
		isOwner && isNewer(PARSER_VERSION, game.parser_version),
	);

	// Re-sync map + visibility state when the loaded game changes (route
	// navigation keeps the component alive across game ids).
	$effect(() => {
		const g = game;
		selectedMapTurn = g.game_details.total_turns;
		mapTiles = g.map_tiles;
		isPublic = (g as { is_public?: boolean }).is_public ?? false;
	});

	async function handleMapTurnChange(turn: number) {
		selectedMapTurn = turn;
		mapTiles = reconstructMapTiles(game, turn);
	}

	async function downloadSave() {
		downloading = true;
		try {
			const { blob, filename } = await cloudApi.downloadGame(gameId);
			// Trigger a browser-level save via a synthetic anchor click. This
			// is the standard pattern for authenticated downloads — we can't
			// use a plain `<a href>` because the request needs cookie auth
			// and the response needs to be saved with the right filename.
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		} catch (err) {
			if (err instanceof UnauthorizedError) {
				// Anonymous viewer clicked Download on a public game — bounce
				// to login so they can come back signed-in. The post-login
				// `next` is honored via the OAuth round-trip (auth.ts).
				const next = encodeURIComponent(page.url.pathname);
				await goto(`/login?next=${next}`);
				return;
			}
			if (err instanceof ApiError && err.status === 429) {
				alert("Too many downloads. Try again in an hour.");
				return;
			}
			alert(`Download failed: ${err instanceof Error ? err.message : err}`);
		} finally {
			downloading = false;
		}
	}

	async function deleteGame() {
		if (!window.confirm("Delete this game permanently?")) return;
		deleting = true;
		try {
			await cloudApi.deleteGame(gameId);
			await goto("/games", { replaceState: true });
		} catch (err) {
			deleting = false;
			alert(`Delete failed: ${err instanceof Error ? err.message : err}`);
		}
	}
</script>

<svelte:head>
	<title>{ogTitle} — Per-Ankh</title>
	<meta property="og:title" content={ogTitle} />
	<meta property="og:description" content={ogDescription} />
	<meta property="og:url" content={ogUrl} />
	<meta property="og:image" content={ogImage} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Per-Ankh" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={ogTitle} />
	<meta name="twitter:description" content={ogDescription} />
	<meta name="twitter:image" content={ogImage} />
	<meta name="description" content={ogDescription} />
</svelte:head>

<main class="isolate flex flex-1 flex-col overflow-hidden">
	<header class="flex shrink-0 items-center justify-between border-b border-brown bg-[#2a2622] px-4 py-2">
		<a href="/games" class="text-sm text-tan hover:text-orange">← Games</a>
		{#if isOwner}
			<div class="flex items-center gap-3">
				<VisibilityToggle {gameId} bind:isPublic />
				<button
					type="button"
					onclick={downloadSave}
					disabled={downloading}
					class="rounded bg-brown px-3 py-1 text-xs text-tan hover:bg-orange disabled:opacity-50"
				>
					{downloading ? "Downloading…" : "Download save"}
				</button>
				<button
					type="button"
					onclick={deleteGame}
					disabled={deleting}
					class="rounded bg-brown px-3 py-1 text-xs text-tan hover:bg-orange disabled:opacity-50"
				>
					{deleting ? "Deleting…" : "Delete game"}
				</button>
			</div>
		{:else}
			<div class="flex items-center gap-3">
				<span class="text-xs text-tan opacity-70">Shared game</span>
				<button
					type="button"
					onclick={downloadSave}
					disabled={downloading}
					class="rounded bg-brown px-3 py-1 text-xs text-tan hover:bg-orange disabled:opacity-50"
				>
					{downloading ? "Downloading…" : "Download save"}
				</button>
			</div>
		{/if}
	</header>
	{#if isReimportAvailable}
		<div class="flex shrink-0 items-center justify-between border-b border-orange bg-orange/10 px-4 py-2">
			<p class="text-xs text-tan">
				This game was parsed with an older version ({game.parser_version}).
				Re-import to refresh the data.
			</p>
			<ReimportButton {gameId} />
		</div>
	{/if}
	<div class="flex-1 overflow-y-auto px-4 pb-8 pt-4">
		<GameDetailView
			gameDetails={game.game_details}
			playerHistory={game.player_history}
			allYields={game.yield_history}
			eventLogs={game.event_logs}
			lawAdoptionHistory={game.law_adoption_history}
			currentLaws={game.current_laws}
			techDiscoveryHistory={game.tech_discovery_history}
			completedTechs={game.completed_techs}
			unitsProduced={game.units_produced}
			cityStatistics={game.city_statistics}
			improvementData={game.improvement_data}
			gameReligions={game.game_religions}
			playerWonders={game.player_wonders}
			{mapTiles}
			{selectedMapTurn}
			onMapTurnChange={handleMapTurnChange}
		/>
	</div>
</main>
