<script lang="ts">
	// One military unit, opened from its marker on the map view — read as the
	// game's own `TOOLTIP_UNIT` (Reference/XML/UI/includes/tooltips-game.xml:270)
	// reads it: the unit and its nation on one line, the attack and defense
	// strip under it, the effect-unit glyphs the game grids beside that strip,
	// and two things the game's tooltip has no room for — the general it names
	// and the turn it was trained.
	//
	// The page owns the Popover wrapper (and its chrome frame), as it does for
	// the city card; this is the content.
	//
	// All of it is the FINAL turn. `UnitInfo` is a snapshot of `<Tile>/<Unit>`
	// and the save carries no unit history of any kind, so unlike the city card
	// there is no per-turn zone to split off — the whole card is one vintage,
	// which is why it has no turn input.
	import type { cloudApi } from "$lib/api-cloud";
	import { unitName } from "$lib/utils/formatting";
	import SpriteIcon from "./SpriteIcon.svelte";
	import {
		characterTraitNames,
		generalOpinionOfLeader,
	} from "./character-opinion";
	import { rulerName, rulerPortrait, unitOwner } from "./helpers";
	import type { DetailPlayer } from "./helpers";
	import { competitiveMode } from "./rating-curve";
	import {
		COMBAT_GAP_NOTES,
		combatGaps,
		generalRatingModifiers,
		unitCombat,
		unitEffectPlayers,
		unitFamilyOpinionBand,
		UNIT_HP_MAX,
	} from "./unit-combat";

	let {
		game,
		players,
		unitXmlId,
		onUnlock,
	}: {
		game: Awaited<ReturnType<typeof cloudApi.getGame>>;
		players: DetailPlayer[];
		unitXmlId: number;
		// Unlock this card — which closes it, since the pointer is on the card
		// when the ✕ is clicked and not on the marker that would hold it open.
		// Its presence is what makes the card a LOCKED one, as it is on the city
		// card and on a locked tile panel, so "locked with no way out" isn't
		// representable. The transient card passes nothing and carries the hint
		// for making a locked one instead.
		onUnlock?: () => void;
	} = $props();

	// `units` isn't required by the Worker's blob schema, so a blob parsed
	// before it existed doesn't carry it. Undefined also covers a card that
	// outlived its unit, which the page's own close rules out.
	const unit = $derived((game.units ?? []).find((u) => u.xml_id === unitXmlId));

	const label = $derived(unit ? unitName(unit.unit_type) : "");

	// Whose unit it is. The same resolver the map marker's plate runs, so the
	// card's heading and the marker that opened it can't disagree on either the
	// name or the colour.
	const owner = $derived(unit ? unitOwner(unit, players) : null);

	// Health, as the complement of accumulated damage. `Unit.getHP`
	// (Unit.cs:2420) is `max(0, getHPMax() − getDamage())` and the maximum is 20
	// for every unit (see UNIT_HP_MAX), so the damage is the whole story.
	//
	// An absent `damage` on a BLOB is not the absent `<Damage>` element in a
	// save: the game writes the element only when it is non-zero
	// (`Unit.writeGameXML`, Unit.cs:972) and the parser reads its absence as 0,
	// so every unit on a blob from PARSER_VERSION 2.22.0+ carries a number.
	// `undefined` means the blob was parsed before the field was read — health
	// is UNKNOWN rather than full — and most stored blobs are of that vintage,
	// so this is the common case rather than an edge. A re-upload turns one
	// into a number.
	const HEALTH_UNKNOWN_NOTE =
		"This game was parsed before unit damage was read, so the save's health is not in the stored data. Re-uploading the save fills it in.";
	const health = $derived(
		unit?.damage === undefined ? null : Math.max(0, UNIT_HP_MAX - unit.damage),
	);

	// Held promotions only. `unit_promotions` carries both what the unit HAS
	// (`<Promotions>`, is_acquired true) and what it is currently OFFERED
	// (`<PromotionsAvailable>`, false), and the offered rows outnumber the held
	// ones four to one across the corpus — 4,064 against 1,401 — so feeding
	// both to the grid would read as a unit with six promotions when it holds
	// two.
	const promotions = $derived(
		(game.unit_promotions ?? [])
			.filter((p) => p.unit_xml_id === unitXmlId && p.is_acquired)
			.map((p) => p.promotion),
	);

	// ─── The general ──────────────────────────────────────────────────
	// `general_xml_id` carries three states and the card renders all three. The
	// game writes `<GeneralID>` only for a unit that has one
	// (`Unit.writeGameXML`, Unit.cs:972, gated on `hasGeneral`), so: a number is
	// the leading character, `null` is a unit nobody leads, and `undefined` is
	// a blob parsed before PARSER_VERSION 2.23.0, where who leads it is UNKNOWN
	// rather than nobody. The unknown arm is the default case for stored blobs
	// today, so it reads the way a missing `damage` does.
	const GENERAL_UNKNOWN_NOTE =
		"This game was parsed before a unit's general was read, so the save's general is not in the stored data. Re-uploading the save fills it in.";

	// The character, resolved as CityPopover resolves a governor: by `xml_id`,
	// so the regnal numeral comes out. There is no arm for an id that resolves
	// to nothing — all 203 of the corpus's generals resolve to a `<Character>`
	// in their own save — so an unresolvable id simply drops the section.
	const general = $derived.by(() => {
		const id = unit?.general_xml_id;
		if (id == null) return null;
		return game.characters.find((c) => c.xml_id === id) ?? null;
	});

	// Null when the blob doesn't say which curve the game runs, which is a blob
	// from before PARSER_VERSION 2.11.0.
	const competitive = $derived(competitiveMode(game.game_details.game_options));

	// Current saves write `<TraitTurn>`, which `parseCharacterTraits`
	// (`src/lib/parser/parsers/character-data.ts`) reads; an older save writes
	// `<Trait>`, which it does not, so the blob carries no traits at ALL for
	// every character in such a save. The test is therefore per-blob rather
	// than per-character: a game with no trait row anywhere cannot say, while a
	// game that has them and no row for this general is saying the general has
	// none. That is 39 of the corpus's 203 generals, all in one 2022 save — and
	// the same element is why `archetypeFromTraits`
	// (`src/lib/parser/parsers/characters.ts`) leaves their archetype glyph
	// blank already.
	const traitsKnown = $derived(game.character_traits.length > 0);

	// The unit's own player. Three things read it: the leader gate below, the
	// effect players its leader's traits confer, and whether the game's AI
	// advantage applies at all.
	const player = $derived(
		unit?.player_xml_id == null
			? undefined
			: game.game_details.players.find(
					(p) => p.player_id === unit.player_xml_id,
				),
	);

	// `isLeader()` gates each trait's `LeaderEffectUnit` and the global
	// `LEADER_GENERAL_EFFECTUNIT`. The blob names the reigning leader per
	// player, which is the same resolution the opinion term runs.
	const generalIsLeader = $derived(
		general != null && player?.leader_character_xml_id === general.xml_id,
	);

	// What the general thinks of their own leader, which is worth −20% to +10%
	// of the unit's strength (`Unit.baseStrengthModifier`, Unit.cs:6334, adds
	// `characterOpinionOfUs(pGeneral).miStrengthModifier`). The save stores no
	// opinion rate — the game recomputes every character's on load — so this
	// recomputes it from the blob, and it lands inside the attack and defense
	// numbers rather than beside them.
	//
	// Null where the answer isn't whole: a character who is not that player's
	// own, or who leads none of its units. A tribal unit has no player to ask
	// about at all, and none of the corpus's 203 generals is on one.
	const opinion = $derived.by(() => {
		if (!general || unit?.player_xml_id == null) return null;
		return generalOpinionOfLeader(game, general.xml_id, unit.player_xml_id);
	});

	// The portrait id when we ship the art, else null — the gate the slot reads
	// and the value SpriteIcon takes, resolved once so they cannot disagree.
	const generalPortrait = $derived(general ? rulerPortrait(general) : null);

	// ─── The three channels that are a blob join ───────────────────────
	// `unit_effects` and `unit_families` arrived together in PARSER_VERSION
	// 2.25.0, so one test covers both: absent means the unit's bonus effects
	// and its family are UNKNOWN rather than none, which is the common case for
	// stored blobs and what the `units` gap reports.
	const unitChannelsKnown = $derived(game.unit_effects !== undefined);

	const bonusEffectUnits = $derived(
		(game.unit_effects ?? [])
			.filter((e) => e.unit_xml_id === unitXmlId)
			.map((e) => e.effect),
	);

	// Which band the unit's own player's opinion of its own family falls in —
	// the one term in the unit's strength that comes from politics.
	const familyOpinionBand = $derived(
		unit
			? unitFamilyOpinionBand(
					unit,
					game.unit_families,
					game.family_opinion_history,
				)
			: null,
	);

	// The reigning leader's traits, which are what the player's own
	// combat-bearing effect players hang off. A different character from the
	// unit's general, and usually a different player's concern entirely.
	const leaderTraits = $derived(
		player?.leader_character_xml_id != null && traitsKnown
			? characterTraitNames(game, player.leader_character_xml_id)
			: [],
	);

	const effectPlayers = $derived(
		unitEffectPlayers(player, game.match_metadata.advantage, leaderTraits),
	);

	// ─── The numbers, and the glyphs they were summed from ─────────────
	const combat = $derived(
		unit
			? unitCombat({
					unitType: unit.unit_type,
					// Absent on a blob that doesn't carry it, which is worth the same
					// as level 0 to the one column that reads it.
					level: unit.level ?? 0,
					// `isDamaged()` on an unknown damage reads as undamaged, which is
					// what the health row already says it cannot confirm.
					damage: unit.damage ?? 0,
					promotions,
					bonusEffectUnits,
					familyOpinionBand,
					effectPlayers,
					general:
						general == null
							? null
							: {
									traits: traitsKnown
										? characterTraitNames(game, general.xml_id)
										: [],
									isLeader: generalIsLeader,
									ratings:
										competitive == null
											? null
											: generalRatingModifiers(general, competitive),
									opinionStrengthModifier: opinion?.strengthModifier ?? 0,
								},
				})
			: null,
	);

	// Why the two numbers may not be the game's own — one marker beside them,
	// with every reason in its title, rather than a paragraph under the card.
	const gaps = $derived(
		unit
			? combatGaps({
					hasPlayer: unit.player_xml_id != null,
					hasGeneral: general != null,
					generalKnown: unit.general_xml_id !== undefined,
					unitChannelsKnown,
					advantageKnown: game.match_metadata.advantage !== undefined,
					isHuman: player?.is_human ?? false,
					ratingsKnown: competitive != null,
					traitsKnown,
				})
			: [],
	);
	const gapNote = $derived(gaps.map((gap) => COMBAT_GAP_NOTES[gap]).join(" "));
</script>

{#if unit && owner && combat}
	<div class="space-y-3 text-xs">
		<header class="flex items-start gap-2">
			<!-- Unit on the left, nation on the right, both at the card's own size
			     — the game's own header line, which sets the unit's name and its
			     nation in the same two sizes side by side. -->
			<!-- Fixed-size slot: SpriteIcon renders nothing when the glyph is
			     missing (4 of the corpus's military units, in 3 types with no
			     `unit.xml` entry), which would unalign the heading. -->
			<span class="flex w-5 flex-none pt-0.5">
				<SpriteIcon
					category="units"
					value={unit.unit_type}
					size={20}
					glyph
					alt={label}
				/>
			</span>
			<h2 class="min-w-0 text-sm font-bold" style="color: {owner.color};">
				{label}
			</h2>
			<p class="ml-auto flex flex-none items-center gap-1 text-sm text-bright">
				<span class="flex w-5 flex-none">
					{#if owner.civilization}
						<SpriteIcon
							category="crests"
							value={owner.civilization}
							size={20}
							alt={owner.label}
						/>
					{/if}
				</span>
				{owner.label}
			</p>
			<!-- The lock pair the city card carries, in the same corner and with
			     the same words: one gesture over the map, said the same way
			     wherever it is read. The marker under the card is what answers
			     it — the card is portaled out of the map and swallows its own
			     right-clicks (the map page's suppressCardContextMenu). -->
			<div class="flex-none pl-1">
				{#if onUnlock}
					<button
						type="button"
						class="cursor-pointer px-0.5 text-[11px] leading-none text-muted transition-colors hover:text-tan focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange"
						onclick={onUnlock}
						aria-label="Unlock {label}"
						title="Unlock">✕</button
					>
				{:else}
					<p class="text-[10px] italic text-muted">Right-click to lock</p>
				{/if}
			</div>
		</header>

		<!-- The stat strip, and the promotion glyphs the game grids beside it. -->
		<section class="flex items-start gap-3">
			<div class="flex flex-none items-center gap-3 text-sm text-bright">
				{#if combat.attack != null}
					<span class="inline-flex items-center gap-1" title={gapNote}>
						{combat.attack}
						<span class="flex w-4 flex-none">
							<SpriteIcon
								category="icons"
								value="ATTACK"
								size={16}
								alt="Attack"
							/>
						</span>
					</span>
				{/if}
				{#if combat.defense != null}
					<span class="inline-flex items-center gap-1" title={gapNote}>
						{combat.defense}
						<span class="flex w-4 flex-none">
							<SpriteIcon
								category="icons"
								value="DEFENSE"
								size={16}
								alt="Defense"
							/>
						</span>
					</span>
				{/if}
			</div>
			{#if combat.promotions.length > 0}
				<!-- Eight to a row, the constraint the game's own UIGrid carries
				     (ConstraintCount="8"). -->
				<ul class="ml-auto grid grid-cols-8 justify-items-end gap-0.5">
					{#each combat.promotions as promotion (promotion.type)}
						<li class="flex h-[13px] w-[13px] flex-none" title={promotion.name}>
							<SpriteIcon
								category="effect-units"
								value={promotion.icon}
								size={13}
								alt={promotion.name}
							/>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section>
			<dl class="chrome-rows record-rows">
				<dt>Health</dt>
				<dd>
					{#if health != null}
						{health} / {UNIT_HP_MAX}
					{:else}
						<span title={HEALTH_UNKNOWN_NOTE}>— / {UNIT_HP_MAX}</span>
					{/if}
				</dd>
				{#if unit.create_turn != null}
					<dt>
						<span class="inline-flex items-center gap-1">
							<span class="flex w-3.5 flex-none">
								<SpriteIcon
									category="icons"
									value="UNIT_BUILD"
									size={14}
									alt="Trained"
								/>
							</span>
							Trained
						</span>
					</dt>
					<dd>Turn {unit.create_turn}</dd>
				{/if}
			</dl>
		</section>

		<!-- What the unit carries without a promotion or a general behind it:
		     its type's and its unit traits' effect units, the band its player's
		     opinion of its family falls in, and whatever its player's own
		     effect players put on it. The game grids all of these beside the
		     stat strip; the card has the room to name them. -->
		{#if combat.own.length > 0}
			<section>
				<!-- Flowed rather than one per line: a military unit carries 2 to 7
				     of these across the corpus, and the game's own tooltip spends a
				     single 8-column strip on them. -->
				<ul class="flex flex-wrap gap-x-3 gap-y-1">
					{#each combat.own as effect (effect.type)}
						<li class="flex items-center gap-1.5 text-[11px] text-bright">
							<!-- Fixed-size slot: two of effectUnit.xml's icon names ship no
							     art, so SpriteIcon renders nothing and the name would
							     otherwise shift left of its neighbours. -->
							<span class="flex w-3.5 flex-none">
								<SpriteIcon
									category="effect-units"
									value={effect.icon}
									size={14}
									alt={effect.name}
								/>
							</span>
							{effect.name}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<!-- The general, and what the general puts on this unit — the game's
		     tooltip names neither, and a unit nobody leads gets no zone at all
		     rather than a rule over the word "None". -->
		{#if unit.general_xml_id === undefined || general != null}
			<section class="general-rule">
				{#if general == null}
					<p class="text-[11px] text-muted" title={GENERAL_UNKNOWN_NOTE}>
						General unknown
					</p>
				{:else}
					<p class="flex items-center gap-1.5 text-[11px] text-bright">
						<!-- Reserved slot: a save can name a portrait neither the Reference
					     XML nor pinacotheca defines, which `rulerPortrait` is the test
					     for. -->
						<span class="flex w-6 flex-none">
							{#if generalPortrait}
								<SpriteIcon
									category="portraits"
									value={generalPortrait}
									size={24}
									alt={rulerName(general) ?? "General"}
								/>
							{/if}
						</span>
						{rulerName(general) ?? "Unnamed"}
					</p>
					{#if combat.general.length > 0}
						<ul class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
							{#each combat.general as effect (effect.type)}
								<li class="flex items-center gap-1.5 text-[11px] text-bright">
									<span class="flex w-3.5 flex-none">
										<SpriteIcon
											category="effect-units"
											value={effect.icon}
											size={14}
											alt={effect.name}
										/>
									</span>
									{effect.name}
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</section>
		{/if}
	</div>
{/if}

<style>
	/* The rule that closes the unit's own record off from its general's
	   contribution, matching the city card's zone rule. */
	.general-rule {
		border-top: 1px solid rgb(var(--color-border-tooltip));
		padding-top: 0.75rem;
	}

	/* `.chrome-rows.record-rows` — the row style this shares with the city
	   card — lives in app.css beside `.chrome-rows` itself. */
</style>
