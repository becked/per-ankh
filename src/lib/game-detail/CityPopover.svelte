<script lang="ts">
	// Everything the blob knows about one city, opened from its banner on the
	// map view.
	//
	// The page owns the Popover wrapper (and its chrome frame), as the
	// tournament bracket's match popover does; this is the content.
	//
	// Most of CityInfo describes the city at the END of the game; only its
	// ownership (and whether it exists at all) is reconstructible per turn. So
	// the card is three zones and nothing crosses between them: an identity
	// header, what's true at the selected turn, and the end-of-game record —
	// the last split into two columns, its statistics beside its territory.
	import type { cloudApi } from "$lib/api-cloud";
	import type { MapTile } from "$lib/types/MapTile";
	import type { UnitInfo } from "$lib/parser/types";
	import { ownershipChangeTurn } from "$lib/parser/types";
	import { getCivilizationColor } from "$lib/config";
	import { IMPROVEMENT_BUILDS } from "$lib/generated/improvement-builds";
	import {
		characterName,
		civilizationName,
		formatEnum,
		nationName,
		turnCount,
		unitName,
	} from "$lib/utils/formatting";
	import SpriteIcon from "./SpriteIcon.svelte";
	import { tileXmlId } from "./reconstruct-map-tiles";
	import {
		KIND_LABELS,
		specialistInfo,
		specialistName,
		type SpecialistKind,
	} from "./specialists";
	import {
		CITY_COLUMNS,
		cityOwner,
		familyCrestKey,
		familyForOwner,
		formatCityCell,
		improvementDisplayName,
		projectDisplayName,
		resolveCityRows,
		rulerName,
		unitOwner,
		type CityColumn,
		type DetailPlayer,
	} from "./helpers";

	let {
		game,
		players,
		cityName,
		turn,
		onUnlock,
	}: {
		game: Awaited<ReturnType<typeof cloudApi.getGame>>;
		players: DetailPlayer[];
		cityName: string;
		turn: number;
		// Unlock this card — which closes it, since the pointer is on the card
		// when the ✕ is clicked and not on the banner that would hold it open.
		// Its presence is what makes the card a LOCKED one, as it is on a
		// locked tile panel (MapTooltip), so "locked with no way out" isn't
		// representable. The transient card passes nothing and carries the
		// hint for making a locked one instead.
		onUnlock?: () => void;
	} = $props();

	const finalTurn = $derived(game.game_details.total_turns);

	// The city's CityInfo row, with founder_nation resolved through the
	// player_nations sidecar. Undefined only if a banner outlived its city
	// row, which the name join rules out.
	const city = $derived.by(() => {
		const row = game.city_statistics.cities.find(
			(c) => c.city_name === cityName,
		);
		return row ? resolveCityRows([row], game.player_nations)[0] : undefined;
	});

	// ─── Zone 2: ownership at the selected turn ───────────────────────
	// The centre tile, from the final snapshot — (x, y) is static, so it's the
	// right key into tile_ownership_history at any turn.
	const centreTile = $derived(
		game.map_tiles.find((t) => t.is_city_center && t.owner_city === cityName),
	);

	type OwnerSpan = { from: number; to: number; playerXmlId: number | null };

	// The centre tile's ownership as spans: who held it, from when to when.
	// `tile_ownership_history` is sparse (one row per change), so each row runs
	// until the next one, and the last runs to the end of the game.
	const ownerSpans = $derived.by(() => {
		const mapWidth = game.game_details.map_width;
		const tile = centreTile;
		if (mapWidth == null || tile == null) return [] as OwnerSpan[];
		const id = tileXmlId(tile.x, tile.y, mapWidth);
		const rows = game.tile_ownership_history
			.filter((e) => e.tile_xml_id === id)
			.sort((a, b) => a.turn - b.turn);
		return rows.map((e, i) => ({
			from: ownershipChangeTurn(e.turn),
			to:
				i + 1 < rows.length
					? ownershipChangeTurn(rows[i + 1].turn) - 1
					: finalTurn,
			playerXmlId: e.owner_player_xml_id,
		}));
	});

	const spanAtTurn = $derived(
		ownerSpans.find((s) => s.from <= turn && turn <= s.to) ?? null,
	);

	// player_xml_id is the resolved players' playerId (both are the XML Player
	// id), so the chrome's label — "Rome", or "Rome (name)" in a mirror — comes
	// straight off the roster.
	function playerAt(playerXmlId: number | null): DetailPlayer | undefined {
		if (playerXmlId == null) return undefined;
		return players.find((p) => p.playerId === playerXmlId);
	}

	const ownerAtTurn = $derived(playerAt(spanAtTurn?.playerXmlId ?? null));

	// The TRIBE holding the city across a span no player does. `<Tribe>` is a
	// single CURRENT value (City.cs:1263, written only under `City.isTribe()`),
	// not a history, so every unowned span is named by the holder at save
	// time — the one value the map paints at every turn too, which is what
	// keeps this card and the banner that opened it agreeing. Measured right
	// for every span it names: of the corpus's 82 player-less cities, 14 carry
	// an EARLIER, closed unowned span as well, and all 14 are held by
	// TRIBE_ANARCHY now, which is what a breached city sits in. A blob from
	// before PARSER_VERSION 2.26.0 carries no `tribe`, and then nothing names
	// the holder.
	function tribeForSpan(span: OwnerSpan | null): string | null {
		if (span == null || span.playerXmlId !== null) return null;
		return city?.tribe ?? null;
	}

	// Who the card names, crests and colours as the holder at the selected
	// turn: the roster player the span names, else the tribe, through the same
	// `cityOwner` the banner and the Cities tab read.
	const tribeOwnerAtTurn = $derived(cityOwner(null, tribeForSpan(spanAtTurn)));

	// The whole ownership record as one line of comma-separated range/holder
	// pairs, reading like the founded line it sits under.
	const ownerSpanLine = $derived(
		ownerSpans
			.map((span) => {
				const held = playerAt(span.playerXmlId);
				const tribe = tribeForSpan(span);
				const range =
					span.from === span.to
						? `Turn ${span.from}`
						: `Turns ${span.from}–${span.to}`;
				const holder =
					held?.label ??
					(tribe != null ? civilizationName(tribe) : "Unowned, mid-capture");
				return `${range} · ${holder}`;
			})
			.join(", "),
	);
	// Who is taking the city, when the selected turn sits inside the capture the
	// SAVE froze — the last ownership span, unowned and running to the final
	// turn. `<CapturePlayer>` is a single current value (City.cs:1251), not a
	// history, and the eventual owner from `tile_ownership_history` is the
	// captor for 1,320 of the corpus's 1,342 closed released spans and the
	// DEFENDER for the other 22. So an EARLIER unowned span names its HOLDER
	// (see `tribeForSpan`) and no captor at all, rather than the wrong one.
	// Null too when the captor is a tribe (`capture_tribe`, which names no
	// player) or when the blob predates the field.
	const captorAtTurn = $derived.by(() => {
		const span = spanAtTurn;
		if (span == null || span.playerXmlId !== null || span.to !== finalTurn) {
			return undefined;
		}
		return playerAt(city?.capture_player_xml_id ?? null);
	});
	const captorColor = $derived(
		(captorAtTurn?.nation ? getCivilizationColor(captorAtTurn.nation) : null) ??
			"rgb(var(--color-tan))",
	);

	const familyAtTurn = $derived(
		city ? familyForOwner(city, spanAtTurn?.playerXmlId ?? null) : null,
	);
	// The game writes `Family="NONE"` for a city with no family
	// (`Infos.zTYPE_NONE`, City.cs:1159) — 6 of the corpus's 326 city rows, all
	// of them mid-capture — and `formatEnum` renders that as "None", a row that
	// says nothing. A real family is what the row is for.
	const familyNameAtTurn = $derived(
		familyAtTurn?.family != null && familyAtTurn.family !== "NONE"
			? familyAtTurn.family
			: null,
	);
	// Per-family crest where we ship the art, else the family-class archetype
	// — the same rule the banner's crest follows.
	const familyCrestAtTurn = $derived(
		familyAtTurn
			? familyCrestKey(familyAtTurn.family, familyAtTurn.familyClass)
			: null,
	);

	// Built as one string: a Svelte `{#if}` inside the line would eat the space
	// before the separator.
	const foundedLine = $derived.by(() => {
		if (!city) return "";
		const founder = city.founder_nation;
		return (
			`Founded turn ${city.founded_turn}` +
			(founder ? ` · ${nationName(founder)}` : "")
		);
	});

	// The header takes its colour and crests from the owner at the selected
	// turn, so the card and the banner that opened it agree — which means the
	// tribe's crest and colour where a tribe holds the city, since that is
	// what the banner draws.
	const nationAtTurn = $derived(ownerAtTurn?.nation ?? null);
	const holderCrestAtTurn = $derived(
		nationAtTurn ?? tribeOwnerAtTurn?.crestKey ?? null,
	);
	const holderColor = $derived(
		(nationAtTurn ? getCivilizationColor(nationAtTurn) : null) ??
			tribeOwnerAtTurn?.color ??
			"rgb(var(--color-tan))",
	);

	// ─── Zone 3: the end-of-game record ───────────────────────────────
	// Rendered through the Cities tab's own column definitions so the labels,
	// formats and icons are the ones that table already uses.
	function column(key: string): CityColumn {
		const col = CITY_COLUMNS.find((c) => c.key === key);
		if (!col) throw new Error(`unknown city column: ${key}`);
		return col;
	}

	const STATE_COLUMNS: CityColumn[] = [
		column("citizens"),
		column("culture_level"),
	];
	const COUNT_COLUMNS: CityColumn[] = [
		column("growth_count"),
		column("unit_production_count"),
		column("specialist_count"),
		column("buy_tile_count"),
		column("hurry_civics_count"),
		column("hurry_money_count"),
		column("hurry_training_count"),
		column("hurry_population_count"),
	];

	// Happiness is signed — negative levels are the game's Discontent — so the
	// label flips with the sign rather than showing a minus.
	const happiness = $derived.by(() => {
		const level = city?.happiness_level;
		if (level == null) return null;
		return level < 0
			? { label: "Discontent", value: -level }
			: { label: "Happiness", value: level };
	});

	// The governing character, by xml_id so the regnal numeral resolves.
	// governor_xml_id arrived in PARSER_VERSION 2.15.0; older blobs carry only
	// the name token, which is what the Cities tab's column shows.
	const governor = $derived.by(() => {
		if (!city) return null;
		const id = city.governor_xml_id;
		const character =
			id != null ? game.characters.find((c) => c.xml_id === id) : undefined;
		const named = character ? rulerName(character) : null;
		if (named) return named;
		return city.governor_name ? characterName(city.governor_name) : null;
	});

	// ─── Zone 3: territory ────────────────────────────────────────────
	// The blob records per-tile PLAYER ownership history, not per-tile CITY
	// assignment, so a city's tiles can only be read off the final snapshot —
	// which is why territory lives in the end-of-game zone and carries no
	// per-turn count.
	const cityTiles = $derived(
		game.map_tiles.filter((t) => t.owner_city === cityName),
	);

	type ImprovementTally = {
		key: string;
		count: number;
		pillaged: number;
		unfinished: number;
	};

	function tallyImprovements(tiles: MapTile[]): ImprovementTally[] {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const byKey = new Map<string, ImprovementTally>();
		for (const t of tiles) {
			if (!t.improvement) continue;
			let tally = byKey.get(t.improvement);
			if (!tally) {
				tally = { key: t.improvement, count: 0, pillaged: 0, unfinished: 0 };
				byKey.set(t.improvement, tally);
			}
			tally.count += 1;
			if (t.improvement_pillaged) tally.pillaged += 1;
			// improvement_turns_left is PARSER_VERSION 2.17.0+; absent reads as
			// "nothing owed", the same as a finished improvement.
			if ((t.improvement_turns_left ?? 0) > 0) tally.unfinished += 1;
		}
		return [...byKey.values()].sort((a, b) =>
			improvementDisplayName(a.key).localeCompare(
				improvementDisplayName(b.key),
			),
		);
	}

	const improvementTallies = $derived(tallyImprovements(cityTiles));
	const wonders = $derived(
		improvementTallies.filter(
			(t) => IMPROVEMENT_BUILDS[t.key]?.kind === "wonder",
		),
	);
	const improvements = $derived(
		improvementTallies.filter(
			(t) => IMPROVEMENT_BUILDS[t.key]?.kind !== "wonder",
		),
	);

	// Placed specialists by name, grouped by the baked urban/rural kind. A
	// zType the baked table doesn't know has no kind and is skipped, as the
	// Specialists tab skips it.
	const specialistGroups = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const byKind = new Map<SpecialistKind, Map<string, number>>();
		for (const t of cityTiles) {
			const kind = specialistInfo(t.specialist)?.kind;
			if (!t.specialist || !kind) continue;
			let names = byKind.get(kind);
			if (!names) {
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
				names = new Map<string, number>();
				byKind.set(kind, names);
			}
			names.set(t.specialist, (names.get(t.specialist) ?? 0) + 1);
		}
		return (["urban", "rural"] as const)
			.filter((kind) => byKind.has(kind))
			.map((kind) => ({
				kind,
				entries: [...byKind.get(kind)!.entries()]
					.map(([key, count]) => ({ key, count }))
					.sort((a, b) =>
						specialistName(a.key).localeCompare(specialistName(b.key)),
					),
			}));
	});

	const resources = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const byKey = new Map<string, number>();
		for (const t of cityTiles) {
			if (!t.resource) continue;
			byKey.set(t.resource, (byKey.get(t.resource) ?? 0) + 1);
		}
		return [...byKey.entries()]
			.map(([key, count]) => ({ key, count }))
			.sort((a, b) => a.key.localeCompare(b.key));
	});

	const roadCount = $derived(cityTiles.filter((t) => t.has_road).length);

	// ─── Zone 3: units in territory ───────────────────────────────────
	// The units standing on this city's tiles. Final-turn only, like the rest
	// of zone 3: the blob carries no per-turn unit positions. The join is the
	// same (x, y) → tile_xml_id key tile_ownership_history uses, and a tile can
	// hold more than one unit (`Tile.canBothUnitsOccupy`, `Tile.cs:10438`
	// — a caravan, an allied pair, two builders), so nothing here assumes one.
	const cityUnits = $derived.by(() => {
		const mapWidth = game.game_details.map_width;
		if (mapWidth == null) return [] as UnitInfo[];
		const ids = new Set(cityTiles.map((t) => tileXmlId(t.x, t.y, mapWidth)));
		// `units` isn't required by the Worker's blob schema, so a blob parsed
		// before it existed doesn't carry it — the same default GameTab applies.
		return (game.units ?? []).filter((u) => ids.has(u.tile_xml_id));
	});

	type UnitGroup = {
		key: string;
		label: string;
		// NATION_* or TRIBE_*, which is what the crest sprite takes.
		civilization: string | null;
		// The heading colour. A player's is its resolved roster colour, which a
		// tribe has none of — see `unitGroups`.
		color: string;
		total: number;
		// One row per unit TYPE, counted — the same tallied shape (and the same
		// `times()` suffix) the improvement, specialist and resource rows above
		// use, down to naming the tallies `entries`. A row per unit would be the
		// longest thing on the card: across test-data/saves, collapsing takes
		// the 1609 units standing on city territory down to 1065 rows, and the
		// worst city from 20 to 11.
		entries: Array<{ key: string; count: number }>;
	};

	// Grouped by the PLAYER that owns the unit, not by its nation: a mirror
	// match (1 of the 16 saves in test-data/saves is NATION_EGYPT ×2) would
	// otherwise merge two opposing Egypts into one group. `DetailPlayer.label`
	// is the nation, disambiguated by name only where it collides. A unit with
	// no player is a tribe's, and groups under the tribe.
	const unitGroups = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const byOwner = new Map<
			string,
			{
				key: string;
				// One of the group's units, which is all `unitOwner` reads — the
				// label and colour are resolved after the sort, because the
				// fallback colour takes the sorted position.
				unit: UnitInfo;
				total: number;
				counts: Map<string, number>;
			}
		>();
		for (const u of cityUnits) {
			const key =
				u.player_xml_id != null ? `P${u.player_xml_id}` : `T${u.tribe ?? ""}`;
			let group = byOwner.get(key);
			if (!group) {
				group = {
					key,
					unit: u,
					total: 0,
					counts: new Map<string, number>(),
				};
				byOwner.set(key, group);
			}
			group.total += 1;
			group.counts.set(u.unit_type, (group.counts.get(u.unit_type) ?? 0) + 1);
		}
		// The city's own owner first — the section exists to show the units that
		// AREN'T the owner's, so a besieged city must not read as a city with a
		// big army. Everyone else by how much of the territory they're standing
		// on, which is the order a reader cares about.
		const ownerKey =
			city?.owner_player_xml_id != null ? `P${city.owner_player_xml_id}` : null;
		return [...byOwner.values()]
			.sort((a, b) => {
				if (a.key === ownerKey) return -1;
				if (b.key === ownerKey) return 1;
				return (
					b.total - a.total ||
					unitOwner(a.unit, players).label.localeCompare(
						unitOwner(b.unit, players).label,
					)
				);
			})
			.map(({ counts, unit, key, total }, i) => {
				// The shared owner rule, with this group's sorted position as the
				// fallback index so two owners neither the roster nor the baked
				// tables answer for still read apart. The map's unit markers and
				// the unit card run the same resolver.
				const owner = unitOwner(unit, players, i);
				return {
					key,
					total,
					label: owner.label,
					civilization: owner.civilization,
					color: owner.color,
					entries: [...counts.entries()]
						.map(([k, count]) => ({ key: k, count }))
						.sort((a, b) => unitName(a.key).localeCompare(unitName(b.key))),
				} satisfies UnitGroup;
			});
	});

	function times(count: number): string {
		return count > 1 ? ` ×${count}` : "";
	}
</script>

{#if city}
	<div class="space-y-3 text-xs">
		<!-- Zone 1: who this is, which never changes. -->
		<header class="flex items-start gap-2">
			<div class="flex flex-shrink-0 items-center gap-1">
				{#if holderCrestAtTurn}
					<SpriteIcon
						category="crests"
						value={holderCrestAtTurn}
						size={20}
						alt={nationAtTurn
							? nationName(nationAtTurn)
							: (tribeOwnerAtTurn?.label ?? "")}
					/>
				{/if}
				{#if familyCrestAtTurn}
					<SpriteIcon
						category="crests"
						value={familyCrestAtTurn}
						size={20}
						alt={formatEnum(familyAtTurn?.family, "FAMILY_")}
					/>
				{/if}
			</div>
			<div class="min-w-0">
				<h2 class="text-sm font-bold" style="color: {holderColor};">
					{#if city.is_capital}<span class="mr-1 opacity-85">★</span
						>{/if}{formatEnum(city.city_name, "CITYNAME_")}
				</h2>
				<p class="text-[11px] text-muted">{foundedLine}</p>
			</div>
			<!-- The lock pair a locked tile panel carries, both in the corner
			     that panel keeps its ✕ in — not at the foot, where it keeps its
			     hint: this card runs to `max-h-[85vh]` and scrolls, so a foot
			     row is off the bottom of a long city's record. The hint is that
			     panel's own words: one gesture over the map, said the same way
			     wherever it is read. The banner under the card is what answers
			     it — the card is portaled out of the map and swallows its own
			     right-clicks (the map page's suppressCardContextMenu). -->
			<div class="ml-auto flex-none pl-2">
				{#if onUnlock}
					<button
						type="button"
						class="cursor-pointer px-0.5 text-[11px] leading-none text-muted transition-colors hover:text-tan focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange"
						onclick={onUnlock}
						aria-label="Unlock {formatEnum(city.city_name, 'CITYNAME_')}"
						title="Unlock">✕</button
					>
				{:else}
					<p class="text-[10px] italic text-muted">Right-click to lock</p>
				{/if}
			</div>
		</header>

		<!-- Zone 2: the only things reconstructible at the selected turn. -->
		<section class="zone-rule">
			<dl class="chrome-rows">
				<dt>Owner</dt>
				<dd>
					{#if ownerAtTurn}
						<span class="inline-flex items-center gap-1">
							{#if ownerAtTurn.nation}
								<SpriteIcon
									category="crests"
									value={ownerAtTurn.nation}
									size={14}
									alt={nationName(ownerAtTurn.nation)}
								/>
							{/if}
							{ownerAtTurn.label}
						</span>
					{:else if tribeOwnerAtTurn}
						<span
							class="inline-flex items-center gap-1"
							style="color: {tribeOwnerAtTurn.color};"
						>
							<SpriteIcon
								category="crests"
								value={tribeOwnerAtTurn.crestKey}
								size={14}
								alt={tribeOwnerAtTurn.label}
							/>
							{tribeOwnerAtTurn.label}
						</span>
					{:else}
						Unowned
					{/if}
				</dd>
				{#if captorAtTurn}
					<dt>Capturing</dt>
					<dd style="color: {captorColor};">
						<span class="inline-flex items-center gap-1">
							{#if captorAtTurn.nation}
								<SpriteIcon
									category="crests"
									value={captorAtTurn.nation}
									size={14}
									alt={nationName(captorAtTurn.nation)}
								/>
							{/if}
							{captorAtTurn.label}
						</span>
					</dd>
				{/if}
				{#if familyNameAtTurn}
					<dt>Family</dt>
					<dd>
						<span class="inline-flex items-center gap-1">
							{#if familyCrestAtTurn}
								<SpriteIcon
									category="crests"
									value={familyCrestAtTurn}
									size={14}
								/>
							{/if}
							{formatEnum(familyNameAtTurn, "FAMILY_")}
						</span>
					</dd>
				{/if}
			</dl>
			{#if ownerSpanLine}
				<p class="mt-1 text-[11px] text-muted">{ownerSpanLine}</p>
			{/if}
		</section>

		<!-- Zone 3: CityInfo's end-of-game snapshot, plus the territory, which
		     is only readable at the end of the game. Two columns, so the card
		     stays short enough not to reposition under the pointer. -->
		<div class="grid gap-x-5 gap-y-3 sm:grid-cols-2">
			<section>
				<dl class="chrome-rows record-rows">
					{#each STATE_COLUMNS as col (col.key)}
						{@const iconValue = col.iconValue
							? col.iconValue(city)
							: col.getValue(city)}
						<dt>{col.label}</dt>
						<dd>
							<span class="inline-flex items-center gap-1">
								{#if col.iconCategory && iconValue != null}
									<SpriteIcon
										category={col.iconCategory}
										value={String(iconValue)}
										size={14}
									/>
								{/if}
								{formatCityCell(col, city)}
							</span>
						</dd>
					{/each}
					{#if happiness}
						<dt>{happiness.label}</dt>
						<dd>{happiness.value}</dd>
					{/if}
					{#if city.damage != null}
						<dt>Damage</dt>
						<dd>{city.damage}</dd>
					{/if}
					{#if city.assimilate_turns != null}
						<dt>Assimilation</dt>
						<dd>
							{city.assimilate_turns === 0
								? "Complete"
								: `${turnCount(city.assimilate_turns)} left`}
						</dd>
					{/if}
					{#if governor}
						<dt>Governor</dt>
						<dd>{governor}</dd>
					{/if}
					{#if city.religions && city.religions.length > 0}
						<dt>Religions</dt>
						<dd class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
							{#each city.religions as religion (religion)}
								<span class="inline-flex items-center gap-1">
									<SpriteIcon
										category="religions"
										value={religion}
										size={14}
										alt={formatEnum(religion, "RELIGION_")}
									/>
									{formatEnum(religion, "RELIGION_")}
								</span>
							{/each}
						</dd>
					{/if}
					{#if city.project_counts && city.project_counts.length > 0}
						<dt>Projects</dt>
						<dd class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
							{#each city.project_counts as entry (entry.project)}
								<span class="inline-flex items-center gap-1">
									<SpriteIcon
										category="projects"
										value={entry.project}
										size={14}
										alt={projectDisplayName(entry.project)}
									/>
									{projectDisplayName(entry.project)}{times(entry.count)}
								</span>
							{/each}
						</dd>
					{/if}
					{#each COUNT_COLUMNS as col (col.key)}
						<dt>{col.label}</dt>
						<dd>{formatCityCell(col, city)}</dd>
					{/each}
				</dl>
			</section>

			<!-- The territory column: what the city holds at game end, and who is
			     standing on it. Both in one grid cell so the roster fills the
			     space beside the taller statistics column instead of extending
			     the card below it. -->
			<div class="space-y-3">
				<section>
					<h4 class="text-[10px] font-bold uppercase tracking-wide text-muted">
						Territory
					</h4>
					<dl class="chrome-rows record-rows">
						<dt>Tiles</dt>
						<dd>{cityTiles.length}</dd>
						{#if wonders.length > 0}
							<dt>Wonders</dt>
							<dd class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
								{#each wonders as tally (tally.key)}
									<span class="inline-flex items-center gap-1">
										<SpriteIcon
											category="improvements"
											value={tally.key}
											size={14}
											alt={improvementDisplayName(tally.key)}
										/>
										{improvementDisplayName(tally.key)}
									</span>
								{/each}
							</dd>
						{/if}
						{#if improvements.length > 0}
							<dt>Improvements</dt>
							<dd class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
								{#each improvements as tally (tally.key)}
									<span class="inline-flex items-center gap-1">
										<SpriteIcon
											category="improvements"
											value={tally.key}
											size={14}
											alt={improvementDisplayName(tally.key)}
										/>
										{improvementDisplayName(tally.key)}{times(
											tally.count,
										)}{#if tally.pillaged > 0}<span class="text-muted">
												({tally.pillaged} pillaged)</span
											>{/if}{#if tally.unfinished > 0}<span class="text-muted">
												({tally.unfinished} unfinished)</span
											>{/if}
									</span>
								{/each}
							</dd>
						{/if}
						{#each specialistGroups as group (group.kind)}
							<dt>{KIND_LABELS[group.kind]} specialists</dt>
							<dd class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
								{#each group.entries as entry (entry.key)}
									<span class="inline-flex items-center gap-1">
										<SpriteIcon
											category="specialists"
											value={entry.key}
											size={14}
											alt={specialistName(entry.key)}
										/>
										{specialistName(entry.key)}{times(entry.count)}
									</span>
								{/each}
							</dd>
						{/each}
						{#if resources.length > 0}
							<dt>Resources</dt>
							<dd class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
								{#each resources as entry (entry.key)}
									<span class="inline-flex items-center gap-1">
										<SpriteIcon
											category="resources"
											value={entry.key}
											size={14}
											alt={formatEnum(entry.key, "RESOURCE_")}
										/>
										{formatEnum(entry.key, "RESOURCE_")}{times(entry.count)}
									</span>
								{/each}
							</dd>
						{/if}
						<dt>Roads</dt>
						<dd>{roadCount}</dd>
					</dl>
				</section>

				{#if unitGroups.length > 0}
					<section>
						<h4
							class="text-[10px] font-bold uppercase tracking-wide text-muted"
						>
							Units in territory
						</h4>
						<div class="mt-1 space-y-1.5">
							{#each unitGroups as group (group.key)}
								<div>
									<h5
										class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide"
										style="color: {group.color};"
									>
										<!-- Fixed-size slot: SpriteIcon renders nothing when
										     the crest is missing (TRIBE_BARBARIANS and
										     TRIBE_RAIDERS have none), which would unalign the
										     heading. -->
										<span class="flex w-3.5 flex-none">
											{#if group.civilization}
												<SpriteIcon
													category="crests"
													value={group.civilization}
													size={14}
													alt={group.label}
												/>
											{/if}
										</span>
										{group.label}
									</h5>
									<!-- The roster reads UNDER its owner's heading, so both
									     the name and its glyph step down from the 10px
									     heading and its 14px crest. -->
									<div
										class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-bright"
									>
										{#each group.entries as tally (tally.key)}
											<span class="inline-flex items-center gap-1">
												<span class="flex w-3 flex-none">
													<SpriteIcon
														category="units"
														value={tally.key}
														size={12}
														glyph
														alt={unitName(tally.key)}
													/>
												</span>
												{unitName(tally.key)}{times(tally.count)}
											</span>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					</section>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* The rule that closes the per-turn zone off from the two columns below
	   it. */
	.zone-rule {
		border-bottom: 1px solid rgb(var(--color-border-tooltip));
		padding-bottom: 0.75rem;
	}

	/* `.chrome-rows.record-rows` — the two end-of-game columns' row style —
	   lives in app.css beside `.chrome-rows` itself, shared with the unit
	   card. */
</style>
