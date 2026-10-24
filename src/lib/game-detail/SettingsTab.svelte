<script lang="ts">
	// A game's setup, in the seven sections Old World's own setup screens
	// declare — the words the player read when they made each choice. The rows
	// and their order come from `gameSetupSections` (./setup-sections), which
	// reads the baked setup tables and applies the game's own visibility rules;
	// this file is the chrome.
	//
	// Above the seven sits an unsectioned strip for the things that aren't setup
	// choices: the game's name, its mode, its scenario and the build it was
	// played on. Below them, the Players table carries the PER-PLAYER
	// parameters, which the game's game-menu hover collapses to the active
	// player's because it is a HUD and we have a roster.
	import type { CharacterInfo } from "$lib/parser/types";
	import type { GameDetails } from "$lib/types/GameDetails";
	import type { DetailPlayer } from "./helpers";
	import { dynastyLeaders } from "./helpers";
	import {
		formatArchetype,
		formatEnum,
		nationName,
	} from "$lib/utils/formatting";
	import {
		gameModeLabel,
		prosperityName,
		setupValueName,
	} from "$lib/map-settings";
	import { gameSetupSections } from "./setup-sections";
	import Panel from "$lib/ui/Panel.svelte";
	import PanelInset from "$lib/ui/PanelInset.svelte";
	import SpriteIcon from "./SpriteIcon.svelte";

	let {
		gameDetails,
		players,
		characters,
		gameVersion,
	}: {
		gameDetails: GameDetails;
		players: DetailPlayer[];
		// The roster of characters, which is where the archetype the game
		// RESOLVED lives — the setup side is a per-player setup list.
		characters: CharacterInfo[];
		// The Old World build the save was written by (`match_metadata
		// .game_version`), which is not a setup choice and so sits in the strip
		// rather than in a section.
		gameVersion: string | null;
	} = $props();

	const sections = $derived(gameSetupSections(gameDetails));

	// The strip's own rows. Scenario comes from the setup bag — no corpus save
	// sets one, so it is normally absent rather than "None".
	const scenario = $derived(gameDetails.setup_parameters?.Scenario ?? null);

	// The setup side of each player's Nation / Archetype / Dynasty, indexed by
	// player xml id — NOT by position in `players`, which is name-sorted.
	// `undefined` on a blob below PARSER_VERSION 2.28.0, which is what hides the
	// parentheticals until the game is reparsed.
	const setupNation = (player: DetailPlayer): string | null =>
		player.player_id == null
			? null
			: (gameDetails.setup_nations?.[player.player_id] ?? null);
	const setupArchetype = (player: DetailPlayer): string | null =>
		player.player_id == null
			? null
			: (gameDetails.setup_archetypes?.[player.player_id] ?? null);
	const setupDynasty = (player: DetailPlayer): string | null =>
		player.player_id == null
			? null
			: (gameDetails.setup_dynasties?.[player.player_id] ?? null);

	// The game rolled something different from what the player picked. `NONE` is
	// the save's "not set" sentinel, not a choice, so it is no divergence; an
	// identical pick is nothing to say twice.
	function divergence(setup: string | null, resolved: string | null): boolean {
		return setup != null && setup !== "NONE" && setup !== resolved;
	}

	// The archetype the game gave each dynasty, by player xml id: its FIRST
	// leader's, which is the character the game's own row resolves a pick
	// against (`leaderAtIndex(0).getArchetype()`, `buildGameParametersDesc`,
	// HelpText.Game.cs:3442) — not the reigning one, whose archetype is a
	// later succession's and changes as the game runs. A plain record rather
	// than a Map, like the other derived per-player indexes here (LeadersTab):
	// rebuilt each derivation and filled in place.
	const resolvedArchetypes = $derived.by(() => {
		const out: Record<number, string> = {};
		for (const player of players) {
			const archetype = dynastyLeaders(characters, player.playerId)[0]
				?.archetype;
			if (archetype) out[player.playerId] = archetype;
		}
		return out;
	});

	/**
	 * The Leader Archetype cell: the archetype the dynasty got, with the
	 * player's pick in parens where the two differ — the shape the Nation and
	 * Dynasty columns beside it already use. (The game's own row prints the
	 * pair the other way round, the pick with the resolved archetype in
	 * parens, and only for a RANDOM pick — HelpText.Game.cs:3441.)
	 *
	 * The pick is a choice and often not an archetype: 37 of the 48 player
	 * rows in `test-data/saves/` picked Random or Pick Later, so the pick
	 * named an archetype for 11 of them, and the resolved archetype differs
	 * from the pick on all 41 rows that have one. Where nothing resolves it
	 * the pick is all there is and reads as the value rather than as a
	 * parenthetical: the other 7 rows, 6 of them in the one save from build
	 * 1.0.62443, whose 682 characters carry no archetype at all, and one a
	 * turn-1 seat with no leader yet.
	 */
	function archetypeCell(player: DetailPlayer): {
		value: string;
		pick: string | null;
	} {
		const setup = setupArchetype(player);
		const resolved = resolvedArchetypes[player.playerId] ?? null;
		if (resolved == null) {
			return { value: setup ? formatArchetype(setup) : "—", pick: null };
		}
		return {
			value: formatArchetype(resolved),
			pick: divergence(setup, resolved) ? formatArchetype(setup ?? "") : null,
		};
	}

	// A setup dynasty only means something for a PRESET leader — the game shows
	// the row on exactly that condition (`buildGameParametersDesc`,
	// HelpText.Game.cs:3453). Any other archetype leaves the field at
	// DYNASTY_DEFAULT, which is the absence of a choice rather than one.
	const PRESET_ARCHETYPE = "TRAIT_PRESET_ARCHETYPE";
	function dynastyWasPicked(player: DetailPlayer): boolean {
		return (
			setupArchetype(player) === PRESET_ARCHETYPE &&
			divergence(setupDynasty(player), player.dynasty ?? null)
		);
	}

	// The three setup columns, shown when any seat can fill one of them. The
	// archetype half of that test is the RESOLVED archetype too, because it
	// comes from `characters` rather than from the setup lists: a blob below
	// PARSER_VERSION 2.28.0 carries no setup list and still names each
	// dynasty's archetype.
	const anyPlayersColumn = $derived(
		players.some(
			(p) =>
				p.development != null ||
				setupArchetype(p) != null ||
				setupDynasty(p) != null ||
				resolvedArchetypes[p.playerId] != null,
		),
	);
</script>

<section class="mb-4 rounded-lg bg-surface p-3">
	<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
		<PanelInset label="Game">
			<p class="text-sm text-bright">
				{gameDetails.game_name || "Unnamed"}
			</p>
		</PanelInset>
		<PanelInset label="Mode">
			<p class="text-sm text-bright">{gameModeLabel(gameDetails.game_mode)}</p>
		</PanelInset>
		{#if scenario}
			<PanelInset label="Scenario">
				<p class="text-sm text-bright">
					{setupValueName(scenario, "SCENARIO_")}
				</p>
			</PanelInset>
		{/if}
		{#if gameVersion}
			<PanelInset label="Old World Version">
				<p class="text-sm text-bright">{gameVersion}</p>
			</PanelInset>
		{/if}
	</div>
</section>

{#if sections.length > 0}
	<div class="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
		{#each sections as section (section.key)}
			<Panel title={section.label}>
				<PanelInset>
					<dl class="flex flex-col gap-1">
						{#each section.rows as row (row.key)}
							{#if row.kind === "parameter"}
								<div
									class="flex items-baseline justify-between gap-3 text-sm {row.indent
										? 'pl-3'
										: ''}"
								>
									<dt class="text-gray-400">{row.label}</dt>
									<dd class="text-right text-bright">{row.value}</dd>
								</div>
							{:else}
								<div class="text-sm">
									<dt class="font-bold text-bright">{row.label}</dt>
									{#if row.help}
										<dd class="text-xs text-gray-400">{row.help}</dd>
									{/if}
								</div>
							{/if}
						{/each}
					</dl>
				</PanelInset>
			</Panel>
		{/each}
	</div>
{/if}

<Panel title="Players">
	<PanelInset class="overflow-x-auto">
		<table class="w-full">
			<thead>
				<tr class="text-left text-xs font-bold text-gray-400">
					<th class="border-b-2 border-surface p-3">Player</th>
					<th class="border-b-2 border-surface p-3">Nation</th>
					<th class="border-b-2 border-surface p-3">Type</th>
					<th class="border-b-2 border-surface p-3">Prosperity</th>
					{#if anyPlayersColumn}
						<th class="border-b-2 border-surface p-3">Development</th>
						<th class="border-b-2 border-surface p-3">Leader Archetype</th>
						<th class="border-b-2 border-surface p-3">Dynasty</th>
					{/if}
					<th class="border-b-2 border-surface p-3">Legitimacy</th>
					<th class="border-b-2 border-surface p-3">State Religion</th>
				</tr>
			</thead>
			<tbody>
				{#each players as player (player.playerId)}
					<tr class="transition-colors duration-200 hover:bg-brown/20">
						<!-- Old World leaves @Name empty on every seat of a
						     single-player save, and on a hotseat game's AI seats —
						     29 of the 48 corpus player rows, 26 of 26 single-player
						     and 3 of 6 hotseat — so the resolved label, which is
						     already on the row, is what names those. -->
						<td class="border-b border-surface p-3 text-left text-tan"
							>{player.player_name || player.label}</td
						>
						<td class="border-b border-surface p-3 text-left text-tan">
							<span class="flex items-center gap-2">
								{#if player.nation}
									<SpriteIcon
										category="crests"
										value={player.nation}
										size={16}
										alt={nationName(player.nation)}
									/>
								{/if}
								{nationName(player.nation)}
								{#if divergence(setupNation(player), player.nation)}
									<span class="text-gray-400"
										>({nationName(setupNation(player))})</span
									>
								{/if}
							</span>
						</td>
						<td class="border-b border-surface p-3 text-left text-tan"
							>{player.is_human ? "Human" : "AI"}</td
						>
						<td class="border-b border-surface p-3 text-left text-tan"
							>{player.difficulty ? prosperityName(player.difficulty) : "—"}</td
						>
						{#if anyPlayersColumn}
							{@const archetype = archetypeCell(player)}
							<td class="border-b border-surface p-3 text-left text-tan"
								>{player.development
									? setupValueName(player.development, "DEVELOPMENT_")
									: "—"}</td
							>
							<td class="border-b border-surface p-3 text-left text-tan">
								{archetype.value}
								{#if archetype.pick}
									<span class="text-gray-400">({archetype.pick})</span>
								{/if}
							</td>
							<td class="border-b border-surface p-3 text-left text-tan">
								{player.dynasty
									? setupValueName(player.dynasty, "DYNASTY_")
									: "—"}
								{#if dynastyWasPicked(player)}
									<span class="text-gray-400"
										>({setupValueName(setupDynasty(player), "DYNASTY_")})</span
									>
								{/if}
							</td>
						{/if}
						<td class="border-b border-surface p-3 text-left text-tan"
							>{player.legitimacy ?? "—"}</td
						>
						<td class="border-b border-surface p-3 text-left text-tan">
							<span class="flex items-center gap-2">
								{#if player.state_religion}
									<SpriteIcon
										category="religions"
										value={player.state_religion}
										size={16}
										alt={formatEnum(player.state_religion, "RELIGION_")}
									/>
								{/if}
								{formatEnum(player.state_religion, "RELIGION_")}
							</span>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</PanelInset>
</Panel>
