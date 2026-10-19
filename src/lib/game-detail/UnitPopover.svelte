<script lang="ts">
	// Everything the blob knows about one military unit, opened from its marker
	// on the map view.
	//
	// The page owns the Popover wrapper (and its chrome frame), as it does for
	// the city card; this is the content.
	//
	// All of it is the FINAL turn. `UnitInfo` is a snapshot of `<Tile>/<Unit>`
	// and the save carries no unit history of any kind, so unlike the city card
	// there is no per-turn zone to split off — the whole card is one vintage,
	// which is why it has no turn input.
	import type { cloudApi } from "$lib/api-cloud";
	import { UNIT_STATS } from "$lib/generated/unit-stats";
	import {
		archetypeSpriteKey,
		formatArchetype,
		formatEnum,
		unitName,
	} from "$lib/utils/formatting";
	import SpriteIcon from "./SpriteIcon.svelte";
	import {
		characterTraitNames,
		generalOpinionOfLeader,
	} from "./character-opinion";
	import { effectUnitHelpGroups } from "./effect-unit-help";
	import {
		promotionName,
		rulerName,
		unitOwner,
		type DetailPlayer,
	} from "./helpers";
	import { competitiveMode } from "./rating-curve";
	import {
		generalEffectTotals,
		generalEffectUnits,
		generalLineRows,
		generalRatingModifiers,
		UNIT_HP_MAX,
	} from "./unit-general";

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

	// `UNIT_STATS` carries `strength` and nothing else combat-related, and that
	// is the unit type's BASE strength — the number this row has always shown
	// wherever the app prints a unit's strength. The general's effect appears as
	// its own rows below rather than folded into it: `Unit.modifiedAttack`
	// (Unit.cs:6366) sums effect units across all ten sources and the save
	// writes no resolved effect-unit list, so a total computed here would be a
	// different number from the game's.
	//
	// Null for a type with art but no stats row — `UNIT_KUSHITE_CAVALRY` has a
	// glyph while current `unit.xml` keeps that name only as another unit's
	// `<zIconName>`, so no entry is baked for it (6 of the corpus's 1,411
	// military units). The row is then omitted rather than showing a zero.
	const strength = $derived(
		unit ? (UNIT_STATS[unit.unit_type]?.strength ?? null) : null,
	);

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
	// ones four to one across the corpus — 4,064 against 1,401 — so rendering
	// both in one list would read as a unit with six promotions when it holds
	// two.
	const promotions = $derived(
		(game.unit_promotions ?? [])
			.filter((p) => p.unit_xml_id === unitXmlId && p.is_acquired)
			.map((p) => p.promotion)
			.sort((a, b) => promotionName(a).localeCompare(promotionName(b))),
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
	// from before PARSER_VERSION 2.11.0: the rows are dropped rather than
	// printed off the wrong curve.
	const competitive = $derived(competitiveMode(game.game_details.game_options));

	// The four rating-derived terms, each exact: one character rating through
	// one coefficient of 1, and all four ratings are on the blob. Every one of
	// the corpus's 203 generals gives its unit at least one non-zero term.
	const modifiers = $derived(
		general && competitive != null
			? generalRatingModifiers(general, competitive)
			: null,
	);

	// What the general thinks of their own leader, which is worth −20% to +10%
	// of the unit's strength (`Unit.baseStrengthModifier`, Unit.cs:6334, adds
	// `characterOpinionOfUs(pGeneral).miStrengthModifier`). The save stores no
	// opinion rate — the game recomputes every character's on load — so this
	// recomputes it from the blob.
	//
	// Null where the answer isn't whole: a character who is not that player's
	// own, or who leads none of its units. A tribal unit has no player to ask
	// about at all, and none of the corpus's 203 generals is on one. A general
	// who IS their player's leader is not a missing case — the rate's own guard
	// gives a null rate, which the game stores as 0, which is Cautious and no
	// modifier at all.
	const opinion = $derived.by(() => {
		if (!general || unit?.player_xml_id == null) return null;
		return generalOpinionOfLeader(game, general.xml_id, unit.player_xml_id);
	});

	// A third kind of unknown, and it reads differently from the other two: the
	// rate is known, but a term the blob could not answer is wide enough to put
	// it in a DIFFERENT band — so the band and its percent could be wrong while
	// the number is not.
	const OPINION_UNCERTAIN_NOTE =
		"The rate is exact, but a term the save doesn't answer — the heir, the council, a social parent or a religion's head — could be enough to move it into the neighbouring band, which is what sets the strength percent.";

	// ─── The general's traits, and what they confer ────────────────────
	// A fourth kind of unknown. Current saves write `<TraitTurn>`, which
	// `parseCharacterTraits` (`src/lib/parser/parsers/character-data.ts`) reads;
	// an older save writes `<Trait>`, which it does not, so the blob carries no
	// traits at ALL for every character in such a save. The test is therefore
	// per-blob rather than per-character: a game with no trait row anywhere
	// cannot say, while a game that has them and no row for this general is
	// saying the general has none. That is 39 of the corpus's 203 generals, all
	// in one 2022 save — and the same element is why `archetypeFromTraits`
	// (`src/lib/parser/parsers/characters.ts`) leaves their archetype glyph
	// blank already.
	const TRAITS_UNKNOWN_NOTE =
		"This save is older than the element the parser reads a character's traits from, so what the general's traits confer is not in the stored data.";
	const traitsKnown = $derived(game.character_traits.length > 0);

	const generalTraits = $derived(
		general && traitsKnown ? characterTraitNames(game, general.xml_id) : [],
	);

	// `isLeader()` gates each trait's `LeaderEffectUnit` and the global
	// `LEADER_GENERAL_EFFECTUNIT`. The blob names the reigning leader per
	// player, which is the same resolution the opinion row runs.
	const generalIsLeader = $derived.by(() => {
		if (!general || unit?.player_xml_id == null) return false;
		const player = game.game_details.players.find(
			(p) => p.player_id === unit.player_xml_id,
		);
		return player?.leader_character_xml_id === general.xml_id;
	});

	const conferrals = $derived(
		unit && generalTraits.length > 0
			? generalEffectUnits(generalTraits, generalIsLeader, unit.unit_type)
			: [],
	);

	// The whole closure folds into the totals; only the trait-direct entries
	// print text. `unit.level` is absent on a blob that doesn't carry it, which
	// is worth the same as level 0 to the one column that reads it.
	const effectTotals = $derived(
		generalEffectTotals(conferrals, unit?.level ?? 0),
	);

	// The line's own rows, with the opinion's strength percent folded into
	// attack and defense the way `buildMakeGeneralLine` prints them — which is
	// why the opinion row below names the band and no longer repeats the
	// percent.
	const modifierRows = $derived(
		modifiers
			? generalLineRows(modifiers, effectTotals, opinion?.strengthModifier ?? 0)
			: [],
	);

	// One pill per trait that actually says something, in the general's own
	// trait order — the grouping, and which conferrals drop out of it, live in
	// `effect-unit-help`.
	const traitGroups = $derived(effectUnitHelpGroups(conferrals));

	const signed = (value: number): string => `${value > 0 ? "+" : ""}${value}`;
</script>

{#if unit && owner}
	<div class="space-y-3 text-xs">
		<header class="flex items-start gap-2">
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
			<div class="min-w-0">
				<h2 class="text-sm font-bold" style="color: {owner.color};">
					{label}
				</h2>
				<p class="flex items-center gap-1 text-[11px] text-muted">
					<span class="flex w-3.5 flex-none">
						{#if owner.civilization}
							<SpriteIcon
								category="crests"
								value={owner.civilization}
								size={14}
								alt={owner.label}
							/>
						{/if}
					</span>
					{owner.label}
				</p>
			</div>
			<!-- The lock pair the city card carries, in the same corner and with
			     the same words: one gesture over the map, said the same way
			     wherever it is read. The marker under the card is what answers
			     it — the card is portaled out of the map and swallows its own
			     right-clicks (the map page's suppressCardContextMenu). -->
			<div class="ml-auto flex-none pl-2">
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

		<section>
			<dl class="chrome-rows record-rows">
				{#if strength != null}
					<dt>Strength</dt>
					<dd>{strength}</dd>
				{/if}
				<dt>Health</dt>
				<dd>
					{#if health != null}
						{health} / {UNIT_HP_MAX}
					{:else}
						<span title={HEALTH_UNKNOWN_NOTE}>— / {UNIT_HP_MAX}</span>
					{/if}
				</dd>
				{#if unit.level != null}
					<dt>Level</dt>
					<dd>{unit.level}</dd>
				{/if}
				{#if unit.xp != null}
					<dt>XP</dt>
					<dd>{unit.xp}</dd>
				{/if}
				{#if unit.create_turn != null}
					<dt>Trained</dt>
					<dd>Turn {unit.create_turn}</dd>
				{/if}
				{#if unit.original_tribe}
					<dt>Hired from</dt>
					<dd>
						<span class="inline-flex items-center gap-1">
							<span class="flex w-3.5 flex-none">
								<SpriteIcon
									category="crests"
									value={unit.original_tribe}
									size={14}
									alt={formatEnum(unit.original_tribe, "TRIBE_")}
								/>
							</span>
							{formatEnum(unit.original_tribe, "TRIBE_")}
						</span>
					</dd>
				{/if}
				{#if promotions.length > 0}
					<dt>Promotions</dt>
					<dd class="flex flex-wrap gap-1">
						{#each promotions as promotion (promotion)}
							<span
								class="rounded px-1.5 py-0.5 text-[10px] text-tan"
								style="background-color: rgb(var(--color-surface-raised));"
							>
								{promotionName(promotion)}
							</span>
						{/each}
					</dd>
				{/if}
			</dl>
		</section>

		<!-- The general, and what the general does to this unit. -->
		<section class="general-rule">
			<h4 class="text-[10px] font-bold uppercase tracking-wide text-muted">
				General
			</h4>
			{#if unit.general_xml_id === undefined}
				<p class="mt-1 text-[11px] text-muted" title={GENERAL_UNKNOWN_NOTE}>
					Unknown
				</p>
			{:else if general == null}
				<p class="mt-1 text-[11px] text-muted">None</p>
			{:else}
				<p class="mt-1 flex items-center gap-1 text-[11px] text-bright">
					<!-- Reserved slot: the archetype glyph resolves through the
					     `traits` category and a character may carry no archetype
					     at all. -->
					<span class="flex w-3.5 flex-none">
						{#if general.archetype}
							<SpriteIcon
								category="traits"
								value={archetypeSpriteKey(general.archetype)}
								size={14}
								alt={formatArchetype(general.archetype)}
							/>
						{/if}
					</span>
					{rulerName(general) ?? "Unnamed"}
				</p>
				{#if modifierRows.length > 0}
					<dl class="chrome-rows record-rows mt-1">
						{#each modifierRows as row (row.label)}
							<dt>{row.label}</dt>
							<dd>{signed(row.value)}{row.suffix}</dd>
						{/each}
					</dl>
				{/if}
				{#if opinion}
					<!-- The band only. Its strength percent is inside the Attack and
					     Defense rows above, because `buildMakeGeneralLine` seeds
					     `iStrengthValue` with it and prints attack as
					     `iAttackValue + iStrengthValue` — so repeating it here
					     would read as a second, addable term. -->
					<dl class="chrome-rows record-rows mt-1">
						<dt>Opinion of leader</dt>
						<dd>
							<span
								title={opinion.uncertain ? OPINION_UNCERTAIN_NOTE : undefined}
							>
								{formatEnum(
									opinion.band,
									"OPINIONCHARACTER_",
								)}{opinion.uncertain ? " (uncertain)" : ""}
							</span>
						</dd>
					</dl>
				{/if}
				<!-- What the general's traits confer, grouped under the trait that
				     confers it and said in the game's own words. -->
				{#if !traitsKnown}
					<p class="mt-2 text-[11px] text-muted" title={TRAITS_UNKNOWN_NOTE}>
						Traits unknown
					</p>
				{:else if traitGroups.length > 0}
					<ul class="mt-2 space-y-1.5">
						{#each traitGroups as group (group.trait)}
							<li class="flex items-baseline gap-1.5">
								<span
									class="flex-none rounded px-1.5 py-0.5 text-[10px] text-tan"
									style="background-color: rgb(var(--color-surface-raised));"
								>
									{group.name}
								</span>
								<span class="min-w-0">
									{#each group.lines as line, index (index)}
										<span class="block text-[11px] text-bright">
											{#each line as segment, segmentIndex (segmentIndex)}
												{#if segment.kind === "text"}{segment.text}{:else}<!--
													Fixed-size slot: SpriteIcon renders nothing when
													`getSpritePath` returns null, and the words either
													side of the glyph would close up. The yield glyphs
													these lines use do ship; the slot is what makes a
													missing one harmless.
												--><span
														class="inline-flex w-3.5 flex-none align-text-bottom"
														><SpriteIcon
															category={segment.category}
															value={segment.value}
															size={14}
															alt={segment.alt}
														/></span
													>{/if}
											{/each}
										</span>
									{/each}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</section>
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
