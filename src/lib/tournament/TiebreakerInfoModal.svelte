<script lang="ts">
	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") onClose();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
	onclick={onClose}
	role="presentation"
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border-2 border-black bg-blue-gray p-5 shadow-lg"
		onclick={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="tiebreaker-info-title"
		tabindex="-1"
	>
		<header class="mb-3 flex items-start justify-between gap-3">
			<h2 id="tiebreaker-info-title" class="text-lg font-bold text-tan">
				How qualification and seeding work
			</h2>
			<button
				type="button"
				class="text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
				onclick={onClose}
				aria-label="Close"
			>
				✕
			</button>
		</header>

		<div class="space-y-3 text-xs text-tan">
			<section>
				<h3 class="mb-1 text-sm font-bold">Qualification</h3>
				<p>
					Anyone who reaches the win threshold during Swiss qualifies for the
					championship bracket — no cap, no cutoff. Tiebreakers below only
					decide bracket seeding, never who's in or out.
				</p>
			</section>

			<section>
				<h3 class="mb-1 text-sm font-bold">Seeding cascade</h3>
				<p class="mb-2 opacity-80">
					Players are sorted into seeds 1, 2, 3, … using this cascade. Each tier
					is consulted only when the previous tier left players tied.
				</p>
				<ol class="ml-4 list-decimal space-y-1">
					<li>
						<strong>Match wins</strong> — total wins in Swiss play.
					</li>
					<li>
						<strong>Head-to-head (H2H)</strong> — among the still-tied players, count
						matches won against the others.
					</li>
					<li>
						<strong>Buchholz cut-1 (B1)</strong> — strength of schedule: sum of opponents'
						final win counts, with the single lowest opponent dropped.
					</li>
					<li>
						<strong>Cumulative (Cum)</strong> — running win total across rounds. Rewards
						early dominance: 3-0 in R3 outranks 3-0 in R5.
					</li>
				</ol>
			</section>

			<section>
				<h3 class="mb-1 text-sm font-bold">Divisions and the bracket</h3>
				<p>
					The two Swiss divisions exist purely so rounds can run in parallel
					(faster tournaments). After Swiss, all qualifiers from both divisions
					are ranked into a single combined list and seeded into one bracket
					using standard 1-vs-N tournament order (seed 1 plays the lowest-ranked
					qualifier, etc.). If the qualifier count isn't a power of 2, top seeds
					receive round-1 byes.
				</p>
			</section>

			<section>
				<h3 class="mb-1 text-sm font-bold">Status labels</h3>
				<ul class="ml-4 list-disc space-y-1">
					<li>
						<strong>Active</strong> — still playing Swiss.
					</li>
					<li>
						<strong>Advanced</strong> (<span class="text-orange">✓</span>) —
						clinched the win threshold; qualified for the bracket.
					</li>
					<li>
						<strong>Eliminated</strong> (<span class="text-orange">✗</span>) —
						hit the loss threshold; out of contention.
					</li>
				</ul>
			</section>
		</div>

		<div class="mt-4 flex justify-end">
			<button
				type="button"
				class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan"
				onclick={onClose}
			>
				Close
			</button>
		</div>
	</div>
</div>
