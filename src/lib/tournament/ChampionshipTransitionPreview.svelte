<script lang="ts">
	import type { CombinedQualifier, TournamentDetail } from "$lib/api-cloud";
	import Checkbox from "$lib/ui/Checkbox.svelte";

	interface Props {
		tournament: TournamentDetail;
		combined: CombinedQualifier[];
		busy?: boolean;
		// Caller invokes onConfirm with override_ranks (an explicit seed
		// order) when the admin needs to manually fix qualifications —
		// otherwise undefined means "use auto-promote".
		// eslint-disable-next-line no-unused-vars -- documentary
		onConfirm: (overrideRanks?: string[]) => void;
		onCancel: () => void;
	}

	let {
		tournament,
		combined,
		busy = false,
		onConfirm,
		onCancel,
	}: Props = $props();

	// Auto-promote pool: everyone with status='advanced' in cascade order.
	const autoQualifiers = $derived(
		combined.filter((c) => c.status === "advanced"),
	);

	const needsOverride = $derived(autoQualifiers.length < 2);

	// When the admin opts into manual seeding (or when we MUST because <2
	// auto-qualifiers), they pick a subset of `combined` in the order they
	// want as seed 1, 2, 3, … The button below confirms that order.
	//
	// Default to the auto-qualifier list so toggling manual edits is a small
	// nudge from the auto path rather than a fresh empty pick.
	let manualOpen = $state(false);
	// svelte-ignore state_referenced_locally
	let manualOrder = $state<string[]>(autoQualifiers.map((q) => q.slot_id));

	function toggleSlot(slotId: string) {
		const idx = manualOrder.indexOf(slotId);
		if (idx >= 0) {
			manualOrder = manualOrder.filter((id) => id !== slotId);
		} else {
			manualOrder = [...manualOrder, slotId];
		}
	}

	function moveUp(slotId: string) {
		const idx = manualOrder.indexOf(slotId);
		if (idx <= 0) return;
		const next = [...manualOrder];
		[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
		manualOrder = next;
	}

	function moveDown(slotId: string) {
		const idx = manualOrder.indexOf(slotId);
		if (idx < 0 || idx >= manualOrder.length - 1) return;
		const next = [...manualOrder];
		[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
		manualOrder = next;
	}

	// Pre-built lookup by slot_id for the bracket-preview labels.
	const labelBySlot = $derived.by(() => {
		const out: Record<string, string> = {};
		for (const c of combined) {
			const div =
				c.division === "A"
					? tournament.division_a_name
					: c.division === "B"
						? tournament.division_b_name
						: "—";
			out[c.slot_id] =
				`${c.discord_username ?? c.slot_id.slice(0, 6)} (${div})`;
		}
		return out;
	});

	function getLabel(slotId: string): string | undefined {
		return labelBySlot[slotId];
	}

	const previewSeeds = $derived(
		manualOpen ? manualOrder : autoQualifiers.map((q) => q.slot_id),
	);

	// Bracket size = next power of 2 ≥ N. Mirrors largestPowerOfTwoAtLeast
	// in cloud/src/tournament/bracket.ts for inline preview.
	function nextPow2(n: number): number {
		if (n < 2) return 0;
		let p = 1;
		while (p < n) p *= 2;
		return p;
	}

	const bracketSize = $derived(nextPow2(previewSeeds.length));
	const byes = $derived(bracketSize - previewSeeds.length);

	// Compute the R1 pairings the way the backend will, for display.
	// Mirror standardBracketPairs (bracket.ts).
	function standardBracketPairs(n: number): Array<[number, number]> {
		if (n < 2) return [];
		if (n === 2) return [[1, 2]];
		const half = standardBracketPairs(n / 2);
		const result: Array<[number, number]> = [];
		for (const [a, b] of half) {
			result.push([a, n + 1 - a]);
			result.push([b, n + 1 - b]);
		}
		return result;
	}

	const r1Preview = $derived.by(() => {
		if (bracketSize < 2) return [];
		const pairs = standardBracketPairs(bracketSize);
		return pairs.map(([a, b]) => ({
			seed_a: a,
			seed_b: b,
			is_bye: b > previewSeeds.length,
			label_a:
				a <= previewSeeds.length
					? (getLabel(previewSeeds[a - 1]) ?? `seed ${a}`)
					: "—",
			label_b:
				b <= previewSeeds.length
					? (getLabel(previewSeeds[b - 1]) ?? `seed ${b}`)
					: "BYE",
		}));
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") onCancel();
	}

	function confirm() {
		if (manualOpen) {
			onConfirm(manualOrder);
		} else {
			onConfirm();
		}
	}

	const canConfirm = $derived(
		!busy &&
			previewSeeds.length >= 2 &&
			(!manualOpen || manualOrder.length >= 2),
	);
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
	onclick={onCancel}
	role="presentation"
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border-2 border-black bg-blue-gray p-5 shadow-lg"
		onclick={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="transition-preview-title"
		tabindex="-1"
	>
		<header class="mb-3 flex items-start justify-between gap-3">
			<h2 id="transition-preview-title" class="text-lg font-bold text-tan">
				Transition to championship
			</h2>
			<button
				type="button"
				class="text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
				onclick={onCancel}
				aria-label="Close"
			>
				✕
			</button>
		</header>

		<div class="space-y-3 text-xs text-tan">
			{#if needsOverride}
				<div
					class="rounded border border-red-500 bg-red-500/10 p-2 text-red-300"
				>
					Only {autoQualifiers.length} player(s) clinched the win threshold; at least
					2 are needed to form a bracket. Use the manual list below to promote additional
					players.
				</div>
			{/if}

			<section>
				<header class="mb-2 flex items-baseline justify-between">
					<h3 class="text-sm font-bold">Bracket preview</h3>
					<span class="opacity-70">
						{previewSeeds.length} qualifier{previewSeeds.length === 1
							? ""
							: "s"}
						→ {bracketSize}-bracket{byes > 0
							? ` (${byes} bye${byes === 1 ? "" : "s"})`
							: ""}
					</span>
				</header>
				<ol class="ml-4 list-decimal space-y-0.5">
					{#each previewSeeds as slotId (slotId)}
						<li>{getLabel(slotId) ?? `seed ${slotId.slice(0, 6)}`}</li>
					{/each}
				</ol>
				{#if r1Preview.length > 0}
					<div class="mt-2 rounded bg-[#35302b] p-2">
						<h4 class="mb-1 text-[11px] font-bold uppercase opacity-70">
							Round 1 pairings
						</h4>
						<ul class="space-y-0.5 text-[11px]">
							{#each r1Preview as m, i (i)}
								<li>
									Seed {m.seed_a} ({m.label_a}) vs
									{#if m.is_bye}
										<span class="text-orange opacity-80"
											>BYE → seed {m.seed_a} advances</span
										>
									{:else}
										Seed {m.seed_b} ({m.label_b})
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</section>

			<section>
				<header class="mb-2 flex items-baseline justify-between">
					<h3 class="text-sm font-bold">
						{manualOpen ? "Manual seed order" : "Override"}
					</h3>
					<button
						type="button"
						class="text-[11px] text-tan underline opacity-70 hover:opacity-100"
						onclick={() => (manualOpen = !manualOpen)}
					>
						{manualOpen ? "Use auto-promotion" : "Edit manually"}
					</button>
				</header>
				{#if manualOpen}
					<p class="mb-2 opacity-70">
						Tick the slots that should be in the bracket. Use ↑ ↓ to reorder;
						the order top-to-bottom becomes seed 1, 2, 3, …
					</p>
					<table class="w-full">
						<thead>
							<tr class="border-b border-black text-left">
								<th class="py-1 pr-2"></th>
								<th class="py-1 pr-2">Seed</th>
								<th class="py-1 pr-2">Player</th>
								<th class="py-1 pr-2 text-right">W-L</th>
								<th class="py-1 pr-2">Status</th>
								<th class="py-1 pr-2"></th>
							</tr>
						</thead>
						<tbody>
							{#each combined as c (c.slot_id)}
								{@const idx = manualOrder.indexOf(c.slot_id)}
								<tr class="border-b border-black border-opacity-30">
									<td class="py-1 pr-2">
										<Checkbox
											checked={idx >= 0}
											onCheckedChange={() => toggleSlot(c.slot_id)}
											ariaLabel={`Include ${c.discord_username ?? c.slot_id.slice(0, 6)}`}
										/>
									</td>
									<td class="py-1 pr-2 font-mono">{idx >= 0 ? idx + 1 : "—"}</td
									>
									<td class="py-1 pr-2">
										{c.discord_username ?? c.slot_id.slice(0, 6)}
										<span class="opacity-50">({c.division ?? "—"})</span>
									</td>
									<td class="py-1 pr-2 text-right font-mono">
										{c.wins}-{c.losses}
									</td>
									<td class="py-1 pr-2">
										{#if c.status === "advanced"}
											<span class="text-orange">qualified</span>
										{:else if c.status === "eliminated"}
											<span class="opacity-60">eliminated</span>
										{:else}
											<span>active</span>
										{/if}
									</td>
									<td class="py-1 pr-2">
										{#if idx >= 0}
											<button
												type="button"
												class="px-1 opacity-60 hover:opacity-100 disabled:opacity-20"
												onclick={() => moveUp(c.slot_id)}
												disabled={idx === 0}
												aria-label="Move up"
											>
												↑
											</button>
											<button
												type="button"
												class="px-1 opacity-60 hover:opacity-100 disabled:opacity-20"
												onclick={() => moveDown(c.slot_id)}
												disabled={idx === manualOrder.length - 1}
												aria-label="Move down"
											>
												↓
											</button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else if needsOverride}
					<p class="opacity-70">
						Toggle "Edit manually" above to pick which slots advance.
					</p>
				{:else}
					<p class="opacity-70">
						Auto-promote: every player at status "advanced" enters the bracket
						in seeding-cascade order.
					</p>
				{/if}
			</section>
		</div>

		<footer class="mt-4 flex justify-end gap-2">
			<button
				type="button"
				class="rounded border border-brown px-3 py-1.5 text-xs text-tan hover:bg-brown disabled:opacity-50"
				onclick={onCancel}
				disabled={busy}
			>
				Cancel
			</button>
			<button
				type="button"
				class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan disabled:opacity-50"
				onclick={confirm}
				disabled={!canConfirm}
			>
				Confirm transition
			</button>
		</footer>
	</div>
</div>
