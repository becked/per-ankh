<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import Breadcrumb, { type Crumb } from "$lib/Breadcrumb.svelte";

	// The guide is a static, shared page, so its trail can't come from the
	// resource hierarchy. The originating tournament (if any) is carried in the
	// URL — `from` is its slug, `name` its display label — so a refresh or
	// shared link reproduces the same trail. Direct visits drop that crumb.
	const fromSlug = $derived(page.url.searchParams.get("from"));
	const fromName = $derived(page.url.searchParams.get("name"));
	const crumbs: Crumb[] = $derived([
		{ label: "Home", href: resolve("/") },
		{ label: "Tournaments", href: resolve("/tournaments") },
		...(fromSlug
			? [
					{
						label: fromName ?? "Tournament",
						href: resolve("/tournaments/[slug]", { slug: fromSlug }),
					},
				]
			: []),
		{ label: "Guide" },
	]);
</script>

<main class="cloud-scroll flex-1 overflow-y-auto px-4 py-8" use:autohideScroll>
	<Breadcrumb {crumbs} class="mb-4" />
	<div
		class="mx-auto grid max-w-screen-2xl gap-x-[4.5rem] gap-y-6 md:grid-cols-2"
	>
		<!-- Left column: the overview flow. -->
		<div>
			<div
				class="rounded-lg p-4"
				style="background-color: rgb(var(--color-surface));"
			>
				<div
					class="rounded-lg p-3"
					style="background-color: rgb(var(--color-surface-raised));"
				>
					<div class="space-y-3 text-xs text-tan">
						<section>
							<h3 class="mb-1 text-sm font-bold">The short version</h3>
							<p class="opacity-80">
								A tournament runs in two phases: a
								<strong>Swiss qualifier</strong> to decide who advances, then a
								single-elimination
								<strong>championship bracket</strong> to crown the champion. Here's
								the whole path from sign-up to champion.
							</p>
						</section>

						<section>
							<h3 class="mb-1 text-sm font-bold">1. Sign up</h3>
							<p>
								Register before the tournament starts. You're placed into one of
								two divisions. Divisions exist only so rounds can run in
								parallel and finish faster — they carry no competitive weight
								once Swiss ends. You can withdraw any time before the tournament
								starts.
							</p>
						</section>

						<section>
							<h3 class="mb-1 text-sm font-bold">2. Play the Swiss rounds</h3>
							<p>
								Each round you're paired against one opponent in your division.
								Round 1 is paired by seed; later rounds pair players with
								similar records and avoid rematches. Report a result by
								uploading the finished save for the match — the winner is read
								from the game, no opponent confirmation needed.
							</p>
						</section>

						<section>
							<h3 class="mb-1 text-sm font-bold">
								3. Advance or get eliminated
							</h3>
							<p>
								You keep playing rounds until you hit one of two thresholds:
								reach the
								<strong>win threshold</strong> and you've <em>advanced</em> —
								you're in the championship bracket and sit out the rest of
								Swiss; reach the <strong>loss threshold</strong> and you're
								<em>eliminated</em>. There's also a hard cap on the number of
								Swiss rounds.
							</p>
						</section>

						<section>
							<h3 class="mb-1 text-sm font-bold">4. Championship bracket</h3>
							<p>
								<strong>Everyone</strong> who reaches the win threshold qualifies
								— there's no cap and no per-division cutoff. All qualifiers from both
								divisions are ranked into a single combined list (the seeding cascade)
								and seeded into one single-elimination bracket using standard 1-vs-N
								order (seed 1 plays the lowest-ranked qualifier, etc.). If the qualifier
								count isn't a power of 2, the top seeds get round-1 byes. Win through
								to the Grand Finals to take the title.
							</p>
						</section>

						<section>
							<h3 class="mb-1 text-sm font-bold">Status labels</h3>
							<ul class="ml-4 list-disc space-y-1">
								<li>
									<strong>Active</strong> — still playing Swiss.
								</li>
								<li>
									<strong>Advanced</strong> (<span class="text-orange">✓</span>)
									— clinched the win threshold; qualified for the bracket.
								</li>
								<li>
									<strong>Eliminated</strong> (<span class="text-orange">✗</span
									>) — hit the loss threshold; out of contention.
								</li>
							</ul>
						</section>
					</div>
				</div>
			</div>
		</div>

		<!-- Right column: seeding + maps. -->
		<div class="space-y-12">
			<div
				class="rounded-lg p-4"
				style="background-color: rgb(var(--color-surface));"
			>
				<div
					class="rounded-lg p-3"
					style="background-color: rgb(var(--color-surface-raised));"
				>
					<div class="space-y-3 text-xs text-tan">
						<section>
							<h3 class="mb-1 text-sm font-bold">Seeding cascade</h3>
							<p class="mb-2 opacity-80">
								Qualifiers are sorted into seeds 1, 2, 3, … using this cascade.
								Each tier is consulted only when the previous tier left players
								tied. The tiebreakers only set bracket <em>seeding</em> — never who's
								in or out.
							</p>
							<ol class="ml-4 list-decimal space-y-1">
								<li>
									<strong>Fewest losses</strong> — everyone who qualifies has the
									same number of wins, so whoever clinched in fewer rounds (fewer
									losses) seeds higher. (In the full table, more wins always comes
									first.)
								</li>
								<li>
									<strong>Head-to-head (H2H)</strong> — among the still-tied players,
									count matches won against the others.
								</li>
								<li>
									<strong>Buchholz cut-1 (B1)</strong> — strength of schedule: sum
									of opponents' final win counts, with the single lowest opponent
									dropped.
								</li>
								<li>
									<strong>Opponents' Buchholz (B2)</strong> — depth of schedule: the
									sum of your opponents' own B1 scores.
								</li>
								<li>
									<strong>Cumulative (Cum)</strong> — running win total across rounds,
									which rewards winning earlier.
								</li>
								<li>
									<strong>Initial seed</strong> — if players are still tied after
									all of the above, the higher initial Swiss seed seeds higher. This
									always settles the order, so seeding never needs a manual tiebreak.
								</li>
							</ol>
						</section>
					</div>
				</div>
			</div>

			<div
				class="rounded-lg p-4"
				style="background-color: rgb(var(--color-surface));"
			>
				<div
					class="rounded-lg p-3"
					style="background-color: rgb(var(--color-surface-raised));"
				>
					<div class="space-y-3 text-xs text-tan">
						<section>
							<h3 class="mb-1 text-sm font-bold">How maps are chosen</h3>
							<p>
								Every match is auto-assigned a map from the tournament's map
								pool when its round is generated — nobody picks. The assignment
								follows a priority order:
							</p>
							<ol class="ml-4 mt-2 list-decimal space-y-1">
								<li>
									<strong>A fresh base map.</strong> As long as the pool still
									has a base map script that <em>neither</em> you nor your opponent
									has played earlier in the tournament, you'll be given one of those.
								</li>
								<li>
									<strong>A forced repeat.</strong> Once every remaining script has
									been played by one of you, a repeat is unavoidable. It then picks
									the script played fewest times between the two of you — and since
									it has to repeat a script, prefers a variant whose exact settings
									(size, options) you haven't actually seen, so the map at least plays
									differently.
								</li>
							</ol>
							<p class="mt-2 opacity-80">
								As a lighter, secondary touch, it also tries to spread different
								scripts across the matches of a single round. Repeat-avoidance
								depends on the pool having enough distinct base scripts: with
								only a couple of base maps, later rounds will have to repeat.
							</p>
						</section>
					</div>
				</div>
			</div>
		</div>
	</div>
</main>
