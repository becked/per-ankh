<script lang="ts">
	// The answer: one row per group, the measure last.
	//
	// Two things the table has to say that the numbers don't. A row the
	// question could not name — a seat with no resolved account, a leader whose
	// archetype the save doesn't record — is kept and labelled rather than
	// dropped, because an answer that quietly omits those reads as complete and
	// is short. And a row cap that was reached is said so, because a reader who
	// can't tell a complete answer from a truncated one has been given a wrong
	// one.

	import ProfileLink from "$lib/ProfileLink.svelte";
	import { TABLE_CLASS, TABLE_FRAME_CLASS } from "$lib/ui/classes";
	import type { CatalogSource, QueryResult } from "./types";
	import { valueLabel } from "./vocabularies";

	let { result, source }: { result: QueryResult; source: CatalogSource } =
		$props();

	// The columns the table draws. `key` columns carry the identity
	// dimension's user_id and slug for the profile link and are never a column
	// of their own.
	const dimensions = $derived(
		result.columns.filter((c) => c.role === "dimension"),
	);
	const measure = $derived(
		result.columns.find((c) => c.role === "measure") ?? null,
	);

	// What a dimension's values are named in, so a nation reads as Rome and a
	// wonder as The Pyramids. Looked up by key against the source the answer
	// was built from.
	const vocabularyOf = (key: string): string | undefined =>
		source.dimensions.find((d) => d.key === key)?.vocabulary;

	// An identity dimension is the one that links: it declares the extra
	// columns its rows carry, and they are what the anchor needs.
	const isIdentity = (key: string): boolean =>
		source.dimensions.find((d) => d.key === key)?.key_columns !== undefined;

	// Integers keep their grouping separators; an average keeps one decimal.
	// Branching on the value rather than on the measure's name, because a
	// measure's key is not a promise about its range.
	function formatMeasure(value: string | number | null): string {
		if (value === null) return "—";
		const n = typeof value === "number" ? value : Number(value);
		if (!Number.isFinite(n)) return String(value);
		return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
	}

	const asString = (value: string | number | null): string | null =>
		value === null ? null : String(value);

	const CELL = "px-3 py-2 text-right tabular-nums";
	const HEAD =
		"px-3 py-1 text-left text-[10px] font-bold uppercase tracking-wide text-gray-100";
</script>

{#if result.rows.length > 0}
	<div class={TABLE_FRAME_CLASS}>
		<div class="min-w-0 flex-1 overflow-x-auto">
			<table class="{TABLE_CLASS} text-sm">
				<thead>
					<tr>
						{#each dimensions as column (column.key)}
							<th scope="col" class={HEAD}>{column.label}</th>
						{/each}
						{#if measure}
							<th scope="col" class="{HEAD} text-right">{measure.label}</th>
						{/if}
					</tr>
				</thead>
				<tbody>
					{#each result.rows as row, i (i)}
						<tr>
							{#each dimensions as column, c (column.key)}
								<td
									class="bg-surface px-3 py-2 text-left {isIdentity(column.key)
										? 'font-semibold text-gray-200'
										: 'text-tan'} {c === 0 ? 'rounded-l-lg' : ''}"
								>
									{#if isIdentity(column.key)}
										{@const label = valueLabel(
											row[column.key],
											column.type,
											undefined,
											"Unlinked seat",
										)}
										<!-- The weight and colour are on the cell, not here:
									     `class` styles the anchor only, so an unlinked seat
									     renders bare and would otherwise sit lighter than the
									     rows that link. -->
										<ProfileLink
											userId={asString(row[`${column.key}_id`])}
											slug={asString(row[`${column.key}_slug`])}
											class="transition-colors hover:text-orange"
										>
											{label}
										</ProfileLink>
									{:else}
										{valueLabel(
											row[column.key],
											column.type,
											vocabularyOf(column.key),
											"Not recorded",
										)}
									{/if}
								</td>
							{/each}
							{#if measure}
								<td
									class="{CELL} rounded-r-lg bg-surface font-bold text-gray-200"
								>
									{formatMeasure(row[measure.key])}
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

<div class="mt-2 flex flex-col gap-0.5 text-xs italic text-tan opacity-70">
	<!-- The measure's own sentence about what it counted. A count that
	     collapsed a match both players uploaded, and one that did not, are
	     different numbers over the same corpus. -->
	<p>{result.measure.note}</p>
	{#if result.truncated}
		<p class="not-italic text-orange opacity-100">
			Showing the first {result.limit} rows — there may be more.
		</p>
	{/if}
</div>
