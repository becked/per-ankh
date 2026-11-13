<script lang="ts">
	// The question composer: what the corpus is being asked, in the catalog's
	// own words. A selection here is a set of catalog keys and literal values —
	// nothing that reaches the Worker is a column name, which is what lets the
	// compiler on the other end have no injection surface to defend.
	//
	// The draft is local state and the URL is the question. They are separate
	// deliberately: a filter value is typed a character at a time, and a page
	// that navigated on each keystroke would spend a read budget per letter.
	// "Run" is what makes a draft a question, and it writes the canonical URL —
	// so the address bar, the link somebody pastes and the edge-cache key are
	// one string.

	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import Select from "$lib/ui/Select.svelte";
	import { INPUT_CLASS } from "$lib/ui/classes";
	import type { SelectOption } from "$lib/ui/types";
	import {
		canonicalQuery,
		filterIsComplete,
		isRangeOp,
		opLabel,
		SORTS,
		sortLabel,
		type Draft,
		type DraftFilter,
		type QuerySort,
	} from "./selection";
	import { vocabularyFor } from "./vocabularies";
	import type { CatalogFilter, FilterOp, QueryCatalog } from "./types";

	let { catalog, draft: initial }: { catalog: QueryCatalog; draft: Draft } =
		$props();

	// Writable derived: tracks the load's draft, but stays reassignable so the
	// builder can edit it until the next one arrives. A new draft arriving —
	// the back button walking to another question — replaces whatever was
	// being edited, which is what keeps the controls showing the question the
	// rows below them answer.
	//
	// Every edit below reassigns `draft` whole rather than writing through it.
	// A derived's value is a plain object, not a `$state` proxy, so a property
	// write would change it without telling anything that reads it.
	let draft = $derived<Draft>(structuredClone(initial));

	function patch(next: Partial<Draft>): void {
		draft = { ...draft, ...next };
	}

	function patchFilter(index: number, next: DraftFilter): void {
		patch({ filters: draft.filters.map((f, i) => (i === index ? next : f)) });
	}

	const source = $derived(
		catalog.sources.find((s) => s.key === draft.source) ?? catalog.sources[0],
	);

	const measure = $derived(
		source.measures.find((m) => m.key === draft.measure) ?? source.measures[0],
	);

	const sourceOptions = $derived<SelectOption[]>(
		catalog.sources.map((s) => ({ value: s.key, label: s.label })),
	);
	const measureOptions = $derived<SelectOption[]>(
		source.measures.map((m) => ({ value: m.key, label: m.label })),
	);
	// A grouping already in the draft is offered only in its own picker, so the
	// same column can't be added twice — which the Worker refuses outright.
	const dimensionOptions = (atIndex: number): SelectOption[] =>
		source.dimensions
			.filter(
				(d) =>
					!draft.dimensions.includes(d.key) ||
					draft.dimensions[atIndex] === d.key,
			)
			.map((d) => ({ value: d.key, label: d.label }));
	// A (key, operator) pair already in the draft is offered only in its own
	// row. Two `in` filters on one column compile to `col IN (A) AND col IN
	// (B)`, which matches nothing, and the Worker refuses the repeated pair
	// outright — so the builder can't compose one. The exclusion is by pair
	// rather than by key because a range is two rows on one column: `gte` and
	// `lte` on `total_turns` is how a window is asked for.
	const opsTakenElsewhere = (key: string, atIndex: number): string[] =>
		draft.filters
			.filter((f, i) => i !== atIndex && f.key === key)
			.map((f) => f.op);

	const freeOp = (
		spec: CatalogFilter,
		atIndex: number,
	): FilterOp | undefined => {
		const taken = opsTakenElsewhere(spec.key, atIndex);
		return spec.ops.find((o) => !taken.includes(o));
	};

	const filterOptions = (atIndex: number): SelectOption[] =>
		source.filters
			.filter((f) => freeOp(f, atIndex) !== undefined)
			.map((f) => ({ value: f.key, label: f.label }));

	const opOptions = (filter: DraftFilter, atIndex: number): SelectOption[] => {
		const spec = specFor(filter);
		if (!spec) return [];
		const taken = opsTakenElsewhere(filter.key, atIndex);
		return spec.ops
			.filter((o) => o === filter.op || !taken.includes(o))
			.map((o) => ({ value: o, label: opLabel(o) }));
	};

	// Whether any (key, operator) pair is left to add, the way the grouping
	// button checks for a column it hasn't used.
	const canAddFilter = $derived(
		source.filters.some((f) => freeOp(f, -1) !== undefined),
	);

	const ROW_CHOICES = [10, 25, 50, 100, 200];
	// A hand-edited or bookmarked `?limit=` the picker doesn't offer is still
	// the cap the answer was computed at — the Worker is asked with the URL's
	// own params — so the control carries it rather than falling back to the
	// placeholder and reading as though no cap were set.
	const limitOptions = $derived<SelectOption[]>(
		[
			...new Set([
				...ROW_CHOICES.filter((n) => n <= catalog.limits.max_rows),
				draft.limit,
			]),
		]
			.sort((a, b) => a - b)
			.map((n) => ({ value: String(n), label: `${n} rows` })),
	);
	const sortOptions = $derived<SelectOption[]>(
		SORTS.filter(
			// Ordering by a grouping there isn't is not a view — the Worker
			// refuses it, so it is not offered either.
			(s) => s !== "dimension_asc" || draft.dimensions.length > 0,
		).map((s) => ({ value: s, label: sortLabel(s) })),
	);

	const query = $derived(canonicalQuery(draft, catalog));
	// The question the rows below answer. Taken from the draft the load read
	// out of the URL rather than from the URL's own text: a hand-edited or
	// bookmarked link can spell the same question a different way — an
	// explicit `sort=measure_desc` that the canonical form drops — and
	// comparing the strings would call that a pending change.
	const asked = $derived(
		page.url.searchParams.get("source") === null
			? null
			: canonicalQuery(initial, catalog),
	);
	const dirty = $derived(query !== asked);

	const incomplete = $derived(draft.filters.some((f) => !filterIsComplete(f)));

	function specFor(filter: DraftFilter): CatalogFilter | null {
		return source.filters.find((f) => f.key === filter.key) ?? null;
	}

	function setSource(key: string | null): void {
		if (key === null || key === draft.source) return;
		const next = catalog.sources.find((s) => s.key === key);
		if (!next) return;
		// Everything the new source cannot reach goes with it. Keeping a
		// grouping the source has no join for would send a selection the
		// Worker refuses, and silently dropping it at send time would answer a
		// wider question than the controls show.
		patch({
			source: next.key,
			measure:
				next.measures.find((m) => m.key === draft.measure)?.key ??
				next.measures[0].key,
			dimensions: draft.dimensions.filter((d) =>
				next.dimensions.some((nd) => nd.key === d),
			),
			filters: draft.filters.filter((f) =>
				next.filters.some((nf) => nf.key === f.key),
			),
		});
	}

	function addDimension(): void {
		const next = source.dimensions.find(
			(d) => !draft.dimensions.includes(d.key),
		);
		if (next) patch({ dimensions: [...draft.dimensions, next.key] });
	}

	function addFilter(): void {
		for (const spec of source.filters) {
			const op = freeOp(spec, -1);
			if (op === undefined) continue;
			patch({ filters: [...draft.filters, { key: spec.key, op, values: [] }] });
			return;
		}
	}

	function setFilterKey(index: number, key: string | null): void {
		const spec =
			key === null ? null : source.filters.find((f) => f.key === key);
		if (!spec) return;
		const op = freeOp(spec, index);
		if (op === undefined) return;
		// A new column means new values: a nation token is not a turn number.
		patchFilter(index, { key: spec.key, op, values: [] });
	}

	function setFilterOp(index: number, op: string | null): void {
		const current = draft.filters[index];
		const spec = specFor(current);
		if (!spec || op === null || !spec.ops.includes(op as FilterOp)) return;
		const next = op as FilterOp;
		// A range bound takes exactly one value, so crossing between the two
		// shapes keeps at most the first.
		patchFilter(index, {
			...current,
			op: next,
			values: isRangeOp(next) ? current.values.slice(0, 1) : current.values,
		});
	}

	// The two controls that feed this never offer a value it would drop: the
	// picker lists only what isn't already a chip, and both controls go
	// disabled at the value cap. The guards stay because `onValueKey` can
	// still send the same typed word twice.
	function addValue(index: number, value: string | null): void {
		const trimmed = value?.trim();
		if (!trimmed) return;
		const current = draft.filters[index];
		if (current.values.includes(trimmed)) return;
		if (current.values.length >= catalog.limits.max_filter_values) return;
		patchFilter(index, { ...current, values: [...current.values, trimmed] });
	}

	function removeValue(index: number, value: string): void {
		const current = draft.filters[index];
		patchFilter(index, {
			...current,
			values: current.values.filter((v) => v !== value),
		});
	}

	function onValueKey(event: KeyboardEvent, index: number): void {
		if (event.key !== "Enter") return;
		event.preventDefault();
		const input = event.currentTarget as HTMLInputElement;
		addValue(index, input.value);
		input.value = "";
	}

	async function run(): Promise<void> {
		// Built rather than mutated — a URL whose search is assigned after
		// construction is a mutable instance the lint rules refuse.
		const next = new URL(`${page.url.pathname}?${query}`, page.url);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- search-param-only update on the current route; URL objects are SvelteKit's documented dynamic-nav API
		await goto(next, { keepFocus: true, noScroll: true });
	}

	const LABEL =
		"w-24 shrink-0 pt-1.5 text-xs font-bold uppercase text-gray-400";
	// The picked-value chip and its remove button, as the challenge rules
	// editor renders them.
	const CHIP =
		"flex items-center gap-1 rounded bg-surface-raised px-1.5 py-0.5 text-xs text-gray-200";
	const CHIP_REMOVE = "text-gray-400 hover:text-danger";
	// INPUT_CLASS as it stands, with no padding of its own layered on: two
	// padding utilities in one class attribute are decided by Tailwind's
	// emission order and not by the order they are written in (see Select).
	const INPUT = `${INPUT_CLASS} text-xs text-tan placeholder:opacity-50 disabled:opacity-50`;
	const GHOST =
		"rounded bg-surface-raised px-2 py-1 text-xs text-tan transition-colors hover:bg-surface-raised-hover disabled:opacity-40";
	const ASK =
		"rounded bg-orange px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-orange/80 disabled:opacity-40";
</script>

<div class="flex flex-col gap-3">
	<div class="flex gap-2">
		<span class={LABEL}>About</span>
		<div class="min-w-0 flex-1">
			<Select
				value={draft.source}
				options={sourceOptions}
				onChange={setSource}
				ariaLabel="What the question is about"
			/>
			<p class="mt-1 text-xs italic text-tan opacity-70">{source.grain}</p>
		</div>
	</div>

	<div class="flex gap-2">
		<span class={LABEL}>Measure</span>
		<div class="min-w-0 flex-1">
			<Select
				value={draft.measure}
				options={measureOptions}
				onChange={(v) => {
					if (v !== null) patch({ measure: v });
				}}
				ariaLabel="What to measure"
			/>
			<!-- Where a count says whether it collapsed a match both players
			     uploaded. The number is unreadable without it. -->
			<p class="mt-1 text-xs italic text-tan opacity-70">{measure.note}</p>
		</div>
	</div>

	<div class="flex gap-2">
		<span class={LABEL}>Grouped by</span>
		<div class="flex min-w-0 flex-1 flex-wrap items-start gap-2">
			{#each draft.dimensions as dim, i (dim)}
				<div class="flex items-center gap-1">
					<Select
						value={dim}
						options={dimensionOptions(i)}
						onChange={(v) => {
							if (v !== null)
								patch({
									dimensions: draft.dimensions.map((d, j) => (j === i ? v : d)),
								});
						}}
						ariaLabel="Grouping {i + 1}"
					/>
					<button
						type="button"
						class={GHOST}
						aria-label="Remove grouping"
						onclick={() =>
							patch({
								dimensions: draft.dimensions.filter((_, j) => j !== i),
							})}>×</button
					>
				</div>
			{/each}
			<button
				type="button"
				class={GHOST}
				disabled={draft.dimensions.length >= catalog.limits.max_dimensions ||
					draft.dimensions.length >= source.dimensions.length}
				onclick={addDimension}>+ Grouping</button
			>
			{#if draft.dimensions.length === 0}
				<p class="pt-1.5 text-xs italic text-tan opacity-70">
					No grouping — one row for the whole corpus.
				</p>
			{/if}
		</div>
	</div>

	<div class="flex gap-2">
		<span class={LABEL}>Where</span>
		<div class="flex min-w-0 flex-1 flex-col gap-2">
			{#each draft.filters as filter, i (i)}
				{@const spec = specFor(filter)}
				{#if spec}
					{@const vocab = vocabularyFor(spec.vocabulary)}
					{@const atValueCap =
						filter.values.length >= catalog.limits.max_filter_values}
					<div class="flex flex-wrap items-center gap-1">
						<Select
							value={filter.key}
							options={filterOptions(i)}
							onChange={(v) => setFilterKey(i, v)}
							ariaLabel="Filter column"
						/>
						<Select
							value={filter.op}
							options={opOptions(filter, i)}
							onChange={(v) => setFilterOp(i, v)}
							ariaLabel="Filter comparison"
						/>

						{#if isRangeOp(filter.op)}
							<input
								class={INPUT}
								type={spec.type === "date" ? "date" : "number"}
								value={filter.values[0] ?? ""}
								aria-label="Filter value"
								oninput={(e) =>
									patchFilter(i, {
										...filter,
										values: e.currentTarget.value
											? [e.currentTarget.value]
											: [],
									})}
							/>
						{:else if spec.type === "boolean"}
							<Select
								value={filter.values[0] ?? "1"}
								options={[
									{ value: "1", label: "Yes" },
									{ value: "0", label: "No" },
								]}
								onChange={(v) =>
									patchFilter(i, { ...filter, values: v ? [v] : [] })}
								ariaLabel="Filter value"
							/>
						{:else if vocab?.options}
							<!-- Minus what's already a chip, so every value the picker
							     offers is one it can add — the same move the challenge
							     rules editor's `without` makes. -->
							<Select
								value=""
								options={vocab.options
									.filter((o) => !filter.values.includes(o))
									.map((o) => ({ value: o, label: vocab.label(o) }))}
								onChange={(v) => addValue(i, v)}
								placeholder={atValueCap
									? `At ${catalog.limits.max_filter_values} values`
									: "Add a value…"}
								disabled={atValueCap}
								resetAfterSelect
								ariaLabel="Filter value"
							/>
						{:else}
							<input
								class={INPUT}
								placeholder={atValueCap
									? `At ${catalog.limits.max_filter_values} values`
									: (vocab?.example ?? "Type a value, then Enter")}
								disabled={atValueCap}
								aria-label="Filter value"
								onkeydown={(e) => onValueKey(e, i)}
							/>
						{/if}

						{#each filter.values as value (value)}
							{#if !isRangeOp(filter.op) && spec.type !== "boolean"}
								<span class={CHIP}>
									{vocab ? vocab.label(value) : value}
									<button
										type="button"
										class={CHIP_REMOVE}
										aria-label="Remove {value}"
										onclick={() => removeValue(i, value)}>×</button
									>
								</span>
							{/if}
						{/each}

						<button
							type="button"
							class={GHOST}
							aria-label="Remove filter"
							onclick={() =>
								patch({
									filters: draft.filters.filter((_, j) => j !== i),
								})}>×</button
						>
					</div>
					{#if spec.help}
						<p class="text-xs italic text-tan opacity-70">{spec.help}</p>
					{/if}
				{/if}
			{/each}
			<div>
				<button
					type="button"
					class={GHOST}
					disabled={draft.filters.length >= catalog.limits.max_filters ||
						!canAddFilter}
					onclick={addFilter}>+ Filter</button
				>
			</div>
		</div>
	</div>

	<div class="flex gap-2">
		<span class={LABEL}>Show</span>
		<div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
			<Select
				value={draft.sort}
				options={sortOptions}
				onChange={(v) => {
					if (v !== null) patch({ sort: v as QuerySort });
				}}
				ariaLabel="Row order"
			/>
			<Select
				value={String(draft.limit)}
				options={limitOptions}
				onChange={(v) => {
					if (v !== null) patch({ limit: Number(v) });
				}}
				ariaLabel="Row cap"
			/>
		</div>
	</div>

	<div class="flex items-center gap-2">
		<button
			type="button"
			class={ASK}
			disabled={incomplete || !dirty}
			onclick={run}>Ask</button
		>
		{#if incomplete}
			<span class="text-xs italic text-tan opacity-70">
				A filter still needs a value.
			</span>
		{:else if dirty && asked !== null}
			<span class="text-xs italic text-tan opacity-70">
				The question has changed.
			</span>
		{/if}
	</div>
</div>
