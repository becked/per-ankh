<script lang="ts">
	// The answer: one row per group, the measure last.
	//
	// One thing the table has to say that the numbers don't. A value the save
	// doesn't record — a leader with no archetype, a game with no prosperity —
	// keeps its row and is labelled, because an answer that quietly omits
	// those reads as complete and is short. Prosperity is the case that shows
	// it: over the 2026-11-10 snapshot its unrecorded row is 429 matches
	// against 475 for Magnificent, and hiding it puts Magnificent at 475 of
	// 510 where the groups sum to 939.
	//
	// Mounted only for an answer that has rows: the empty answer is the page's
	// (src/routes/stats/explore/+page.svelte), which draws it in the same frame
	// the rows land in. So there is no empty branch here, and a table this
	// component drew is never a table with no body.
	//
	// The one NULL with no row is an identity dimension's. The Worker drops
	// the seats that resolve to no account, so every row of the Player column
	// names one (PLAYER_USER_ID_SQL, cloud/src/query/catalog.ts).

	import ProfileLink from "$lib/ProfileLink.svelte";
	import { TABLE_CLASS, TABLE_FRAME_INSET_CLASS } from "$lib/ui/classes";
	import type { CatalogSource, QueryCatalog, QueryResult } from "./types";
	import ValueIcon from "./ValueIcon.svelte";
	import { valueLabel, vocabularyFor } from "./vocabularies";

	// `rosters` is the half of the vocabulary the Worker serves — a
	// tournament's name, an account's name and avatar. One of them reaches a
	// cell: the Player column's name arrives on the row, but its avatar does
	// not, so the picture is looked up in the `player` roster by the user_id the
	// row carries beside the name. That roster is scoped to the accounts a
	// question can return (PLAYER_ROSTER_SQL, cloud/src/query/catalog.ts), so
	// every Player row has an entry; a failed roster read serves an empty one,
	// which drops the avatars from this table and the builder's picker together
	// and leaves the reserved boxes empty.
	//
	// Labels and icons both resolve through the functions the builder's chips
	// use, so the table cannot drift into showing an id where the chip above it
	// shows a name, or a picture the picker doesn't.
	let {
		result,
		source,
		rosters,
	}: {
		result: QueryResult;
		source: CatalogSource;
		rosters: QueryCatalog["rosters"];
	} = $props();

	// The columns the table draws, each with what every one of its cells needs.
	// `key` columns carry the identity dimension's user_id and slug for the
	// profile link and are never a column of their own.
	//
	// The vocabulary is resolved here rather than in the cell: resolving a
	// served roster's builds a Map over the whole roster, and the answer is the
	// same for all 200 rows (MAX_ROWS) of one column.
	const columns = $derived(
		result.columns
			.filter((c) => c.role === "dimension")
			.map((c) => {
				const dim = source.dimensions.find((d) => d.key === c.key);
				return {
					...c,
					// What the column's values are named and pictured in, so a nation
					// reads as Rome and a wonder as The Pyramids.
					vocab: vocabularyFor(dim?.vocabulary, rosters),
					// An identity dimension is the one that links: it declares the extra
					// columns its rows carry, and they are what the anchor needs.
					identity: dim?.key_columns !== undefined,
				};
			}),
	);
	const measure = $derived(
		result.columns.find((c) => c.role === "measure") ?? null,
	);

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

<div class={TABLE_FRAME_INSET_CLASS}>
	<div class="min-w-0 flex-1 overflow-x-auto">
		<table class="{TABLE_CLASS} text-sm">
			<thead>
				<tr>
					{#each columns as column (column.key)}
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
						{#each columns as column, c (column.key)}
							{@const iconOf = column.vocab?.icon}
							<!-- An identity row's picture is the account's, which the roster
							     lists under its user_id — the key column beside the name, not
							     the name in the cell. -->
							{@const iconKey = asString(
								column.identity ? row[`${column.key}_id`] : row[column.key],
							)}
							<td
								class="bg-surface px-3 py-2 text-left {column.identity
									? 'font-semibold text-gray-200'
									: 'text-tan'} {c === 0 ? 'rounded-l-lg' : ''}"
							>
								<span class="inline-flex items-center gap-1.5">
									{#if iconOf}
										<!-- Drawn in every row of a column whose vocabulary has art,
										     empty box included, so the labels keep one left edge. -->
										<ValueIcon
											src={iconKey === null ? null : iconOf(iconKey)}
											round={column.identity}
										/>
									{/if}
									{#if column.identity}
										<!-- The account's effective display name, which the
										     Worker selects as this column; `users.display_name` is
										     NOT NULL, so the cell always has a name to print. The
										     weight and colour are on the cell, not here: `class`
										     styles the anchor only, so a row ProfileLink renders
										     bare would otherwise sit lighter than the rows that
										     link. -->
										<ProfileLink
											userId={asString(row[`${column.key}_id`])}
											slug={asString(row[`${column.key}_slug`])}
											class="transition-colors hover:text-orange"
										>
											{row[column.key]}
										</ProfileLink>
									{:else}
										{valueLabel(
											row[column.key],
											column.type,
											column.vocab,
											"Not recorded",
										)}
									{/if}
								</span>
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
