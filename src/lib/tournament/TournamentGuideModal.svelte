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
		aria-labelledby="tournament-guide-title"
		tabindex="-1"
	>
		<header class="mb-3 flex items-start justify-between gap-3">
			<h2 id="tournament-guide-title" class="text-lg font-bold text-tan">
				How a tournament works
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
				<h3 class="mb-1 text-sm font-bold">The short version</h3>
				<p class="opacity-80">
					A tournament runs in two phases: a <strong>Swiss qualifier</strong> to
					decide who advances, then a single-elimination
					<strong>championship bracket</strong> to crown the champion. Here's the
					whole path from sign-up to champion.
				</p>
			</section>

			<section>
				<h3 class="mb-1 text-sm font-bold">1. Sign up</h3>
				<p>
					Register before the tournament starts. You're placed into one of two
					divisions. Divisions exist only so rounds can run in parallel and
					finish faster — they carry no competitive weight once Swiss ends. You
					can withdraw any time before the tournament starts.
				</p>
			</section>

			<section>
				<h3 class="mb-1 text-sm font-bold">2. Play the Swiss rounds</h3>
				<p>
					Each round you're paired against one opponent in your division. Round
					1 is paired by seed; later rounds pair players with similar records
					and avoid rematches. Report a result by uploading the finished save
					for the match — the winner is read from the game, no opponent
					confirmation needed.
				</p>
			</section>

			<section>
				<h3 class="mb-1 text-sm font-bold">3. Advance or get eliminated</h3>
				<p>
					You keep playing rounds until you hit one of two thresholds: reach the
					<strong>win threshold</strong> and you've <em>advanced</em> — you're
					in the championship bracket and sit out the rest of Swiss; reach the
					<strong>loss threshold</strong> and you're <em>eliminated</em>.
					There's also a hard cap on the number of Swiss rounds.
				</p>
			</section>

			<section>
				<h3 class="mb-1 text-sm font-bold">4. Championship bracket</h3>
				<p>
					<strong>Everyone</strong> who reaches the win threshold qualifies — there's
					no cap and no per-division cutoff. All qualifiers from both divisions are
					ranked into a single combined list (the seeding cascade below) and seeded
					into one single-elimination bracket using standard 1-vs-N order (seed 1
					plays the lowest-ranked qualifier, etc.). If the qualifier count isn't a
					power of 2, the top seeds get round-1 byes. Win through to the Grand Finals
					to take the title.
				</p>
			</section>

			<section>
				<h3 class="mb-1 text-sm font-bold">Seeding cascade</h3>
				<p class="mb-2 opacity-80">
					Qualifiers are sorted into seeds 1, 2, 3, … using this cascade. Each
					tier is consulted only when the previous tier left players tied. The
					tiebreakers only set bracket <em>seeding</em> — never who's in or out.
				</p>
				<ol class="ml-4 list-decimal space-y-1">
					<li>
						<strong>Fewest losses</strong> — everyone who qualifies has the same number
						of wins, so whoever clinched in fewer rounds (fewer losses) seeds higher.
						(In the full table, more wins always comes first.)
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
						<strong>Opponents' Buchholz (B2)</strong> — depth of schedule: the sum
						of your opponents' own B1 scores.
					</li>
					<li>
						<strong>Cumulative (Cum)</strong> — running win total across rounds, which
						rewards winning earlier.
					</li>
					<li>
						<strong>Initial seed</strong> — if players are still tied after all of
						the above, the higher initial Swiss seed seeds higher. This always settles
						the order, so seeding never needs a manual tiebreak.
					</li>
				</ol>
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
				class="bg-orange/20 hover:bg-orange/40 rounded border border-tan px-3 py-1.5 text-xs text-tan"
				onclick={onClose}
			>
				Close
			</button>
		</div>
	</div>
</div>
