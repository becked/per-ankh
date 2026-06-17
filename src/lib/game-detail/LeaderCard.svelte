<script lang="ts">
	import type {
		CharacterInfo,
		CharacterTraitInfo,
		PlayerGoalInfo,
	} from "$lib/parser/types";
	import type { DetailPlayer, Reign } from "./helpers";
	import SpriteIcon from "./SpriteIcon.svelte";
	import Popover from "$lib/ui/Popover.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import { GOAL_NAMES } from "$lib/generated/goal-names";

	let {
		reign,
		player,
		totalTurns,
	}: {
		reign: Reign;
		player: DetailPlayer | null;
		totalTurns: number;
	} = $props();

	let open = $state(false);

	const ruler = $derived(reign.ruler);

	// ─── Display helpers ──────────────────────────────────────────────
	const rulerName = (c: CharacterInfo): string =>
		formatEnum(c.first_name, "NAME_") || "Unknown";

	const cognomen = (c: CharacterInfo): string | null =>
		c.cognomen ? formatEnum(c.cognomen, "COGNOMEN_") : null;

	const archetypeLabel = (c: CharacterInfo): string | null =>
		c.archetype
			? formatEnum(c.archetype.replace(/_ARCHETYPE$/, ""), "TRAIT_")
			: null;

	// Archetype icon key for the `traits` sprite category: the save's
	// TRAIT_<X>_ARCHETYPE trait maps to the icon file TRAIT_<X> (suffix dropped).
	const archetypeIcon = (c: CharacterInfo): string | null =>
		c.archetype ? c.archetype.replace(/_ARCHETYPE$/, "") : null;

	const deathLabel = (reason: string | null): string | null =>
		reason
			? formatEnum(
					reason.replace(/^TEXT_(TRAIT_)?/, "").replace(/_(F|M)$/, ""),
					"",
				)
			: null;

	// Age at death, or at game end if the ruler outlived the save — using the
	// same turn-as-year convention as the reign length. birth_turn can be
	// negative (born before turn 1), which the subtraction handles correctly.
	const ageAtEnd = (c: CharacterInfo): number =>
		Math.max(0, (c.death_turn ?? totalTurns) - c.birth_turn);

	const traitLabel = (t: CharacterTraitInfo): string =>
		formatEnum(t.trait_name, "TRAIT_");

	// Goal enums are internal ids whose token order is meaningless
	// (GOAL_FIVE_CAPTURE_CITIES → "Five Capture Cities"). Prefer the baked
	// in-game name ("Capture Five Foreign Cities"), falling back to formatEnum.
	const goalLabel = (g: PlayerGoalInfo): string =>
		GOAL_NAMES[g.goal_type] ?? formatEnum(g.goal_type, "GOAL_");

	const yearsLabel = $derived(
		`Reign ${reign.start}–${reign.end} (${reign.years} ${reign.years === 1 ? "year" : "years"})`,
	);

	const ratingBlocks = $derived([
		{ label: "Wisdom", value: ruler.wisdom, icon: "RATING_WISDOM" },
		{ label: "Charisma", value: ruler.charisma, icon: "RATING_CHARISMA" },
		{ label: "Courage", value: ruler.courage, icon: "RATING_COURAGE" },
		{ label: "Discipline", value: ruler.discipline, icon: "RATING_DISCIPLINE" },
	]);

	// Traits excluding the archetype marker (shown separately as the archetype).
	const detailTraits = $derived(
		reign.traits.filter((t) => !t.trait_name.endsWith("_ARCHETYPE")),
	);
</script>

<Popover
	bind:open
	ariaLabel={rulerName(ruler)}
	contentClass="w-[min(92vw,32rem)]"
>
	{#snippet trigger({ props })}
		<!-- Compact leader card: archetype image, name, years of reign. -->
		<button
			{...props}
			type="button"
			class="flex items-center gap-2 rounded bg-[#35302b] px-2.5 py-1.5 text-left transition hover:brightness-125"
		>
			{#if ruler.portrait}
				<div class="overflow-hidden rounded">
					<SpriteIcon
						category="portraits"
						value={ruler.portrait}
						size={46}
						alt={rulerName(ruler)}
					/>
				</div>
			{/if}
			<div>
				<div
					class="flex items-center gap-1 whitespace-nowrap text-sm font-bold text-tan"
				>
					{#if archetypeIcon(ruler)}
						<SpriteIcon
							category="traits"
							value={archetypeIcon(ruler) ?? ""}
							size={14}
							alt={archetypeLabel(ruler) ?? ""}
						/>
					{/if}
					<span>{rulerName(ruler)}</span>
					{#if cognomen(ruler)}
						<span class="font-normal text-gray-400">the {cognomen(ruler)}</span>
					{/if}
				</div>
				<div
					class="mt-0.5 flex items-center justify-center gap-2 text-xs text-tan"
				>
					{#each ratingBlocks as block (block.label)}
						<span class="flex items-center gap-0.5" title={block.label}>
							<SpriteIcon
								category="icons"
								value={block.icon}
								size={12}
								alt={block.label}
							/>
							{block.value ?? "—"}
						</span>
					{/each}
				</div>
				<div class="whitespace-nowrap text-center text-xs text-gray-400">
					{yearsLabel}
				</div>
			</div>
		</button>
	{/snippet}

	<!-- ─── Full leader detail ──────────────────────────────────────── -->
	<header
		class="mb-4 flex items-start justify-between gap-3 border-b-2 border-orange pb-3"
	>
		<div class="flex flex-wrap items-center gap-3">
			{#if player?.nation}
				<SpriteIcon
					category="crests"
					value={player.nation}
					size={28}
					alt={formatEnum(player.nation, "NATION_")}
				/>
			{/if}
			{#if ruler.portrait}
				<div class="overflow-hidden rounded">
					<SpriteIcon
						category="portraits"
						value={ruler.portrait}
						size={28}
						alt={rulerName(ruler)}
					/>
				</div>
			{/if}
			<div>
				<div class="flex items-center gap-1.5 text-base font-bold text-tan">
					{#if archetypeIcon(ruler)}
						<SpriteIcon
							category="traits"
							value={archetypeIcon(ruler) ?? ""}
							size={18}
							alt={archetypeLabel(ruler) ?? ""}
						/>
					{/if}
					<span>
						{rulerName(ruler)}
						{#if cognomen(ruler)}
							<span class="font-normal text-gray-400"
								>the {cognomen(ruler)}</span
							>
						{/if}
					</span>
				</div>
				<div class="text-xs text-gray-400">
					{#if archetypeLabel(ruler)}
						{archetypeLabel(ruler)} ·
					{/if}
					{yearsLabel}
					{#if deathLabel(ruler.death_reason)}
						· Died: {deathLabel(ruler.death_reason)}
					{/if}
					· Age: {ageAtEnd(ruler)}
				</div>
			</div>
		</div>
		<button
			type="button"
			class="text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
			onclick={() => (open = false)}
			aria-label="Close"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-5 w-5"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M6 18L18 6M6 6l12 12"
				/>
			</svg>
		</button>
	</header>

	<!-- Headline stats: character attributes, then legitimacy -->
	<div class="mb-4 flex flex-wrap gap-1.5">
		{#each ratingBlocks as block (block.label)}
			<div
				class="flex items-center gap-1 rounded px-2 py-1"
				style="background-color: rgb(var(--color-surface-raised));"
				title={block.label}
			>
				<span class="text-xs font-bold text-tan">{block.value ?? "—"}</span>
				<SpriteIcon
					category="icons"
					value={block.icon}
					size={14}
					alt={block.label}
				/>
			</div>
		{/each}
		<div
			class="flex items-center gap-1 rounded px-2 py-1"
			style="background-color: rgb(var(--color-surface-raised));"
			title="Legitimacy"
		>
			<span class="text-xs font-bold text-tan">
				{reign.netLegitimacy ?? "—"}
			</span>
			<SpriteIcon
				category="yields"
				value="YIELD_LEGITIMACY"
				size={14}
				alt="Legitimacy"
			/>
		</div>
	</div>

	<!-- Traits -->
	<div class="mb-4">
		<div class="mb-1 text-xs font-bold text-gray-400">Traits</div>
		{#if detailTraits.length > 0}
			<div class="flex flex-wrap gap-1.5">
				{#each detailTraits as trait (trait.trait_name + trait.acquired_turn)}
					<span
						class="rounded px-2 py-0.5 text-xs text-tan"
						style="background-color: rgb(var(--color-surface-raised));"
						title="Acquired turn {trait.acquired_turn}"
					>
						{traitLabel(trait)}
					</span>
				{/each}
			</div>
		{:else}
			<p class="text-xs italic text-gray-400">None recorded</p>
		{/if}
	</div>

	<!-- Ambitions -->
	<div>
		<div class="mb-1 text-xs font-bold text-gray-400">Ambitions</div>
		{#if reign.ambitions.length > 0}
			<ul class="flex flex-col gap-1">
				{#each reign.ambitions as ambition (ambition.goal_xml_id)}
					{@const done = ambition.completed_turn != null}
					{@const failed = ambition.failed_turn != null}
					<li class="flex items-center gap-2 text-xs text-tan">
						<span class={done || failed ? "" : "opacity-40"}>
							<SpriteIcon
								category="icons"
								value={failed ? "GOAL_FAILED" : "TURN_SUMMARY_AMBITION"}
								size={14}
								alt={failed ? "Failed ambition" : "Ambition"}
							/>
						</span>
						<span>{goalLabel(ambition)}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-xs italic text-gray-400">None pursued</p>
		{/if}
	</div>
</Popover>
