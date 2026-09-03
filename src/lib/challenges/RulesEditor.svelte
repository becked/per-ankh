<script lang="ts">
	// The creator's rules form: objectives and criteria. Shared by
	// /challenges/new and the creator's edit panel on the challenge page, so a
	// rule can only be authored one way. The parent owns the arrays (bindable,
	// deep $state) and this component mutates them in place.
	import Checkbox from "$lib/ui/Checkbox.svelte";
	import Select from "$lib/ui/Select.svelte";
	import { WONDER_CULTURE_PREREQ } from "$lib/generated/wonders";
	import {
		isSelectGroup,
		type SelectGroup,
		type SelectOption,
		type SelectOptions,
	} from "$lib/ui/types";
	import { describeObjective } from "./describe";
	import {
		ANY_RELIGION,
		ANY_WONDER,
		type ChallengeSetup,
		type Criterion,
		type CriterionKind,
		type Objective,
		type ObjectiveKind,
	} from "./types";
	import {
		ANY_WONDER_OPTION,
		COGNOMEN_OPTIONS,
		CULTURE_OPTIONS,
		IMPROVEMENT_OPTIONS,
		LEADER_TRAIT_OPTIONS,
		METRIC_OPTIONS,
		RELIGION_OPTIONS,
		SPECIALIST_OPTIONS,
		TECH_OPTIONS,
		UNIT_OPTIONS,
		WONDER_OPTIONS,
		YIELD_OPTIONS,
	} from "./vocab";

	let {
		setup,
		objectives = $bindable(),
		criteria = $bindable(),
	}: {
		setup: ChallengeSetup;
		objectives: Objective[];
		criteria: Criterion[];
	} = $props();

	// Only a completed wonder can be dated — the save never records when a
	// tile was improved — so the deadline field exists for nothing else.
	function datable(o: Extract<Objective, { kind: "build" }>): boolean {
		return (
			o.state !== "started" &&
			(o.target === ANY_WONDER || o.target in WONDER_CULTURE_PREREQ)
		);
	}

	// Builds limited to what the map actually allows: its enabled wonders
	// (any, then each), then every ordinary improvement.
	const buildOptions = $derived<SelectOption[]>([
		...(setup.wonders.length > 0 ? [ANY_WONDER_OPTION] : []),
		...WONDER_OPTIONS.filter((o) => setup.wonders.includes(o.value)),
		...IMPROVEMENT_OPTIONS,
	]);

	const KIND_OPTIONS: SelectOption[] = [
		{ value: "tech", label: "Research a tech" },
		{ value: "build", label: "Build an improvement or wonder" },
		{ value: "unit", label: "Train units" },
		{ value: "army", label: "Have an army" },
		{ value: "city", label: "Have cities" },
		{ value: "capture", label: "Capture cities" },
		{ value: "religion", label: "Found a religion" },
		{ value: "cognomen", label: "Earn a cognomen" },
		{ value: "metric", label: "Reach a yield or score" },
		{ value: "victory", label: "Win the game" },
	];

	function newObjective(kind: ObjectiveKind): Objective {
		switch (kind) {
			case "tech":
				return { kind, target: TECH_OPTIONS[0].value };
			case "build":
				return { kind, target: buildOptions[0].value, count: 1 };
			case "unit":
				return { kind, target: UNIT_OPTIONS[0].value, count: 1 };
			case "army":
				return { kind, count: 10 };
			case "city":
				return { kind, count: 1 };
			case "capture":
				return { kind, count: 1 };
			case "religion":
				return { kind, target: ANY_RELIGION };
			case "cognomen":
				return { kind, target: COGNOMEN_OPTIONS[0].value };
			case "metric":
				return { kind, metric: "YIELD_SCIENCE", measure: "rate", value: 100 };
			case "victory":
				return { kind };
		}
	}

	function addObjective(kind: string | null) {
		if (kind) objectives.push(newObjective(kind as ObjectiveKind));
	}

	function removeObjective(i: number) {
		objectives.splice(i, 1);
	}

	// Number inputs: blank clears an optional field rather than writing NaN.
	const flat = (options: SelectOptions): SelectOption[] =>
		(options as readonly (SelectOption | SelectGroup)[]).flatMap((o) =>
			isSelectGroup(o) ? o.options : [o],
		);
	function labelOf(options: SelectOptions, key: string): string {
		return flat(options).find((o) => o.value === key)?.label ?? key;
	}
	// The picker's options minus what's already picked; groups keep their
	// headings.
	function without(options: SelectOptions, chosen: string[]): SelectOptions {
		const keep = (o: SelectOption) => !chosen.includes(o.value);
		return (options as readonly (SelectOption | SelectGroup)[]).some(
			isSelectGroup,
		)
			? (options as readonly SelectGroup[]).map((g) => ({
					...g,
					options: g.options.filter(keep),
				}))
			: (options as readonly SelectOption[]).filter(keep);
	}

	// The family-count bounds are optional together: no bound, no `count`.
	function setFamilyCount(
		c: Extract<Criterion, { kind: "families" }>,
		bound: "min" | "max",
		e: Event,
	) {
		const next = { ...c.count, [bound]: num(e) };
		c.count =
			next.min === undefined && next.max === undefined ? undefined : next;
	}

	function num(e: Event): number | undefined {
		const raw = (e.currentTarget as HTMLInputElement).value.trim();
		if (raw === "") return undefined;
		const n = Number(raw);
		return Number.isFinite(n) ? n : undefined;
	}

	// --- Criteria ---------------------------------------------------------

	const CRITERION_LABELS: Record<CriterionKind, string> = {
		families: "Family opinion floor",
		cities: "No damaged cities",
		leader: "Leader",
		economy: "Positive economy",
		max_cities: "City cap",
	};
	const CRITERION_KINDS = Object.keys(CRITERION_LABELS) as CriterionKind[];

	function defaultCriterion(kind: CriterionKind): Criterion {
		switch (kind) {
			case "families":
				return { kind, min_opinion: -100, scope: "seated" };
			case "cities":
				return { kind, scope: "founded" };
			case "leader":
				return { kind, standard_traits_only: true };
			case "economy":
				return { kind, min_rates: { YIELD_MONEY: 0 } };
			case "max_cities":
				return { kind, n: 4 };
		}
	}

	function criterionIndex(kind: CriterionKind): number {
		return criteria.findIndex((c) => c.kind === kind);
	}

	function toggleCriterion(kind: CriterionKind, on: boolean) {
		const i = criterionIndex(kind);
		if (on && i === -1) criteria.push(defaultCriterion(kind));
		if (!on && i !== -1) criteria.splice(i, 1);
	}

	// --- Count maps (city improvements/specialists, economy rates) --------

	// Blank keeps the old value — a row is removed with its × button, and the
	// economy criterion must keep at least one yield.
	function setCount(map: Record<string, number>, key: string, e: Event) {
		const n = num(e);
		if (n !== undefined) map[key] = n;
	}

	// Drop a key; an emptied map becomes "no requirement" rather than `{}`.
	function dropKey(
		map: Record<string, number> | undefined,
		key: string,
	): Record<string, number> | undefined {
		if (!map) return undefined;
		const rest = Object.fromEntries(
			Object.entries(map).filter(([k]) => k !== key),
		);
		return Object.keys(rest).length > 0 ? rest : undefined;
	}

	const inputClass =
		"w-20 rounded border border-input bg-surface-raised p-1 text-xs focus:border-input-focus focus:outline-none";
</script>

{#snippet numberField(
	label: string,
	value: number | undefined,
	// eslint-disable-next-line no-unused-vars -- parameter in callback signature
	oninput: (e: Event) => void,
	min = 0,
)}
	<label class="flex items-center gap-1">
		<span class="text-gray-400">{label}</span>
		<input
			type="number"
			{min}
			value={value ?? ""}
			{oninput}
			class={inputClass}
		/>
	</label>
{/snippet}

<!-- A picked list as chips plus an add picker — the army's unit types, the
     leader's required traits. -->
{#snippet chipList(
	items: string[] | undefined,
	options: SelectOptions,
	placeholder: string,
	ariaLabel: string,
	// eslint-disable-next-line no-unused-vars -- parameter in callback signature
	onAdd: (key: string) => void,
	// eslint-disable-next-line no-unused-vars -- parameter in callback signature
	onRemove: (key: string) => void,
)}
	<div class="flex flex-wrap items-center gap-1">
		{#each items ?? [] as key (key)}
			<span
				class="flex items-center gap-1 rounded bg-surface-raised px-1.5 py-0.5 text-gray-200"
			>
				{labelOf(options, key)}
				<button
					type="button"
					class="text-gray-400 hover:text-danger"
					aria-label="Remove"
					onclick={() => onRemove(key)}
				>
					×
				</button>
			</span>
		{/each}
		<Select
			value=""
			options={without(options, items ?? [])}
			{placeholder}
			{ariaLabel}
			resetAfterSelect
			onChange={(v) => {
				if (v) onAdd(v);
			}}
			class="w-40"
		/>
	</div>
{/snippet}

{#snippet countMap(
	map: Record<string, number> | undefined,
	options: SelectOption[],
	addLabel: string,
	valueLabel: string,
	// eslint-disable-next-line no-unused-vars -- parameter in callback signature
	onAdd: (key: string) => void,
	// eslint-disable-next-line no-unused-vars -- parameter in callback signature
	onRemove: (key: string) => void,
)}
	<div class="flex flex-col gap-1">
		{#each Object.keys(map ?? {}) as key (key)}
			<div class="flex items-center gap-2">
				<span class="min-w-32 text-gray-200">
					{options.find((o) => o.value === key)?.label ?? key}
				</span>
				<label class="flex items-center gap-1">
					<span class="text-gray-400">{valueLabel}</span>
					<input
						type="number"
						value={map?.[key]}
						oninput={(e) => {
							if (map) setCount(map, key, e);
						}}
						class={inputClass}
					/>
				</label>
				<button
					type="button"
					class="text-gray-400 hover:text-danger"
					aria-label="Remove"
					onclick={() => onRemove(key)}
				>
					×
				</button>
			</div>
		{/each}
		<Select
			value=""
			options={options.filter((o) => !(o.value in (map ?? {})))}
			placeholder={addLabel}
			ariaLabel={addLabel}
			resetAfterSelect
			onChange={(v) => {
				if (v) onAdd(v);
			}}
			class="w-56"
		/>
	</div>
{/snippet}

<div class="flex flex-col gap-5 text-xs text-tan">
	<section>
		<h3 class="mb-1 text-xs font-bold uppercase tracking-wide text-gray-400">
			Objectives
		</h3>
		<p class="mb-2 text-gray-400">
			Every objective must be met in the same save; the score is that save's
			turn. Deadlines are optional — a challenge without them is a race.
		</p>
		<ol class="flex flex-col gap-2">
			{#each objectives as o, i (o)}
				<li
					class="flex flex-col gap-2 rounded border border-input p-2"
					style="background-color: rgb(var(--color-surface-raised));"
				>
					<div class="flex items-center justify-between gap-2">
						<span class="font-semibold text-gray-200">
							{i + 1}. {describeObjective(o)}
						</span>
						<button
							type="button"
							class="text-gray-400 hover:text-danger"
							aria-label="Remove objective"
							onclick={() => removeObjective(i)}
						>
							×
						</button>
					</div>
					<div class="flex flex-wrap items-center gap-3">
						{#if o.kind === "tech"}
							<Select
								value={o.target}
								options={TECH_OPTIONS}
								ariaLabel="Tech"
								onChange={(v) => {
									if (v) o.target = v;
								}}
								class="w-56"
							/>
							{@render numberField(
								"by turn",
								o.by_turn,
								(e) => (o.by_turn = num(e)),
								1,
							)}
						{:else if o.kind === "build"}
							<Select
								value={o.target}
								options={buildOptions}
								ariaLabel="Improvement"
								onChange={(v) => {
									if (v) o.target = v;
									if (!datable(o)) delete o.by_turn;
								}}
								class="w-56"
							/>
							<Select
								value={o.state ?? "completed"}
								options={[
									{ value: "completed", label: "completed" },
									{ value: "started", label: "started" },
								]}
								ariaLabel="State"
								onChange={(v) => {
									o.state = v === "started" ? "started" : undefined;
									if (!datable(o)) delete o.by_turn;
								}}
								class="w-32"
							/>
							{@render numberField(
								"count",
								o.count,
								(e) => (o.count = num(e)),
								1,
							)}
							{#if datable(o)}
								{@render numberField(
									"by turn",
									o.by_turn,
									(e) => (o.by_turn = num(e)),
									1,
								)}
							{/if}
						{:else if o.kind === "unit"}
							<Select
								value={o.target}
								options={UNIT_OPTIONS}
								ariaLabel="Unit"
								onChange={(v) => {
									if (v) o.target = v;
								}}
								class="w-56"
							/>
							{@render numberField(
								"count",
								o.count,
								(e) => (o.count = num(e)),
								1,
							)}
						{:else if o.kind === "army"}
							{@render numberField(
								"units",
								o.count,
								(e) => (o.count = num(e) ?? 1),
								1,
							)}
							{@render chipList(
								o.types,
								UNIT_OPTIONS,
								o.types ? "+ type" : "any type",
								"Unit type",
								(v) => (o.types = [...(o.types ?? []), v]),
								(v) => {
									const rest = (o.types ?? []).filter((x) => x !== v);
									o.types = rest.length > 0 ? rest : undefined;
								},
							)}
							{@render numberField(
								"min strength",
								o.min_strength,
								(e) => (o.min_strength = num(e)),
							)}
							{@render numberField(
								"min types",
								o.min_types,
								(e) => (o.min_types = num(e)),
								1,
							)}
							{@render numberField(
								"each with at least",
								o.min_per_type,
								(e) => (o.min_per_type = num(e)),
								1,
							)}
							<Checkbox
								checked={o.unique_only ?? false}
								onCheckedChange={(c) => (o.unique_only = c || undefined)}
								label="unique units only"
							/>
							<Checkbox
								checked={o.land_only ?? false}
								onCheckedChange={(c) => (o.land_only = c || undefined)}
								label="land units only"
							/>
							<Checkbox
								checked={o.trained_only ?? false}
								onCheckedChange={(c) => (o.trained_only = c || undefined)}
								label="trained, not starting"
							/>
						{:else if o.kind === "city"}
							<Checkbox
								checked={o.capital ?? false}
								onCheckedChange={(c) => (o.capital = c || undefined)}
								label="your capital"
							/>
							{#if !o.capital}
								{@render numberField(
									"count",
									o.count,
									(e) => (o.count = num(e)),
									1,
								)}
							{/if}
							<Select
								value={o.culture ?? ""}
								options={CULTURE_OPTIONS}
								placeholder="any culture"
								ariaLabel="Culture"
								onChange={(v) => (o.culture = v ?? undefined)}
								class="w-40"
							/>
							{@render numberField(
								"min happiness",
								o.min_happiness,
								(e) => (o.min_happiness = num(e)),
								-100,
							)}
							<div class="flex w-full flex-col gap-2 sm:flex-row sm:gap-6">
								<div class="flex flex-col gap-1">
									<span class="text-gray-400">with improvements</span>
									{@render countMap(
										o.improvements,
										IMPROVEMENT_OPTIONS,
										"Add improvement…",
										"×",
										(k) => ((o.improvements ??= {})[k] = 1),
										(k) => (o.improvements = dropKey(o.improvements, k)),
									)}
								</div>
								<div class="flex flex-col gap-1">
									<span class="text-gray-400">staffing specialists</span>
									{@render countMap(
										o.specialists,
										SPECIALIST_OPTIONS,
										"Add specialist…",
										"×",
										(k) => ((o.specialists ??= {})[k] = 1),
										(k) => (o.specialists = dropKey(o.specialists, k)),
									)}
								</div>
							</div>
						{:else if o.kind === "capture"}
							<Checkbox
								checked={o.capital ?? false}
								onCheckedChange={(c) => (o.capital = c || undefined)}
								label="the enemy capital"
							/>
							{#if !o.capital}
								{@render numberField(
									"count",
									o.count,
									(e) => (o.count = num(e)),
									1,
								)}
							{/if}
							{@render numberField(
								"by turn",
								o.by_turn,
								(e) => (o.by_turn = num(e)),
								1,
							)}
						{:else if o.kind === "religion"}
							<Select
								value={o.target}
								options={RELIGION_OPTIONS}
								ariaLabel="Religion"
								onChange={(v) => {
									if (v) o.target = v;
								}}
								class="w-48"
							/>
							<Checkbox
								checked={o.state_religion ?? false}
								onCheckedChange={(c) => (o.state_religion = c || undefined)}
								label="adopt as state religion"
							/>
							{@render numberField(
								"min theology tier",
								o.min_theology_tier,
								(e) => (o.min_theology_tier = num(e)),
								1,
							)}
							{@render numberField(
								"by turn",
								o.by_turn,
								(e) => (o.by_turn = num(e)),
								1,
							)}
						{:else if o.kind === "cognomen"}
							<Select
								value={o.target}
								options={COGNOMEN_OPTIONS}
								ariaLabel="Cognomen"
								onChange={(v) => {
									if (v) o.target = v;
								}}
								class="w-56"
							/>
						{:else if o.kind === "metric"}
							<Select
								value={o.metric}
								options={METRIC_OPTIONS}
								ariaLabel="Metric"
								onChange={(v) => {
									if (v) o.metric = v;
								}}
								class="w-48"
							/>
							{#if o.metric.startsWith("YIELD_")}
								<Select
									value={o.measure ?? "rate"}
									options={[
										{ value: "rate", label: "per turn" },
										{ value: "cumulative", label: "total" },
									]}
									ariaLabel="Measure"
									onChange={(v) =>
										(o.measure = v === "cumulative" ? "cumulative" : "rate")}
									class="w-32"
								/>
							{/if}
							{@render numberField(
								"value",
								o.value,
								(e) => (o.value = num(e) ?? 0),
							)}
							{@render numberField(
								"by turn",
								o.by_turn,
								(e) => (o.by_turn = num(e)),
								1,
							)}
						{:else if o.kind === "victory"}
							{@render numberField(
								"by turn",
								o.by_turn,
								(e) => (o.by_turn = num(e)),
								1,
							)}
						{/if}
					</div>
				</li>
			{/each}
		</ol>
		<div class="mt-2">
			<Select
				value=""
				options={KIND_OPTIONS}
				placeholder="Add objective…"
				ariaLabel="Add objective"
				resetAfterSelect
				onChange={addObjective}
				class="w-64"
			/>
		</div>
	</section>

	<section>
		<h3 class="mb-1 text-xs font-bold uppercase tracking-wide text-gray-400">
			Criteria
		</h3>
		<p class="mb-2 text-gray-400">
			Conditions the finishing save must satisfy. The standard three are
			pre-selected.
		</p>
		<div class="flex flex-col gap-2">
			{#each CRITERION_KINDS as kind (kind)}
				{@const idx = criterionIndex(kind)}
				{@const c = idx === -1 ? null : criteria[idx]}
				<div
					class="flex flex-col gap-2 rounded border border-input p-2"
					style="background-color: rgb(var(--color-surface-raised));"
				>
					<Checkbox
						checked={c !== null}
						onCheckedChange={(on) => toggleCriterion(kind, on)}
						label={CRITERION_LABELS[kind]}
						labelClass="font-semibold text-gray-200"
					/>
					{#if c}
						<div class="flex flex-wrap items-center gap-3 pl-6">
							{#if c.kind === "families"}
								{@render numberField(
									"no family below",
									c.min_opinion,
									(e) => (c.min_opinion = num(e) ?? -100),
									-200,
								)}
								<Select
									value={c.scope}
									options={[
										{ value: "seated", label: "seated families" },
										{ value: "all", label: "all families" },
									]}
									ariaLabel="Scope"
									onChange={(v) => (c.scope = v === "all" ? "all" : "seated")}
									class="w-40"
								/>
								<span class="text-gray-400">· founded with</span>
								{@render numberField("at least", c.count?.min, (e) =>
									setFamilyCount(c, "min", e),
								)}
								{@render numberField("at most", c.count?.max, (e) =>
									setFamilyCount(c, "max", e),
								)}
							{:else if c.kind === "cities"}
								<Select
									value={c.scope}
									options={[
										{ value: "founded", label: "cities you founded" },
										{ value: "all", label: "all your cities" },
									]}
									ariaLabel="Scope"
									onChange={(v) => (c.scope = v === "all" ? "all" : "founded")}
									class="w-44"
								/>
							{:else if c.kind === "leader"}
								<Checkbox
									checked={c.standard_traits_only}
									onCheckedChange={(on) => (c.standard_traits_only = on)}
									label="no dynasty-unique traits on a custom leader"
								/>
								<span class="text-gray-400">must pick</span>
								{@render chipList(
									c.required_traits,
									LEADER_TRAIT_OPTIONS,
									"+ trait",
									"Required trait",
									(v) =>
										(c.required_traits = [...(c.required_traits ?? []), v]),
									(v) => {
										const rest = (c.required_traits ?? []).filter(
											(x) => x !== v,
										);
										c.required_traits = rest.length > 0 ? rest : undefined;
									},
								)}
							{:else if c.kind === "economy"}
								{@render countMap(
									c.min_rates,
									YIELD_OPTIONS,
									"Add yield…",
									"≥",
									(k) => (c.min_rates[k] = 0),
									(k) => {
										if (Object.keys(c.min_rates).length > 1)
											delete c.min_rates[k];
									},
								)}
							{:else if c.kind === "max_cities"}
								{@render numberField(
									"at most",
									c.n,
									(e) => (c.n = num(e) ?? 1),
									1,
								)}
								<span class="text-gray-400">cities</span>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</section>
</div>
