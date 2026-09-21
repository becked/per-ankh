<script lang="ts">
	// Twelve players the profile's owner should get a close game against.
	//
	// Owner-only, and the only tab that is: the others are facts about the
	// profile (it has channels, it holds a tournament slot), this one is about
	// the viewer. The gate is not really the tab bar though — the endpoint
	// behind it is /users/me/opponents, which has no by-id form, so there is no
	// URL that serves anyone else's list.
	//
	// The model that picks them runs entirely in the Worker and this component
	// is deliberately incapable of showing a rating: the payload carries none,
	// so there is no number here to leak into a tooltip, a title attribute or a
	// sort. Everything rendered is either identity or a fact the viewer could
	// have established by opening the profile themselves. The order is the one
	// the rebuild stored — most recently active first — and says nothing about
	// rating, which is why nothing here is numbered.
	import { resolve } from "$app/paths";
	import DiscordMark from "$lib/ui/DiscordMark.svelte";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import type {
		OpponentBadge,
		RecommendedOpponent,
		RecommendedOpponents,
	} from "$lib/api-cloud";

	let {
		suggestions,
		openToMatches,
	}: {
		suggestions: RecommendedOpponents;
		// The owner's own listing preference. Surfaced here, not only in
		// Settings, because this is where the exchange becomes visible: they are
		// reading a list they are not on.
		openToMatches: boolean;
	} = $props();

	const opponents = $derived(suggestions.opponents);

	// Badge copy. Each one is checkable by hand from what the opponent's
	// profile already shows — how many rated games they have played in public,
	// and when the last of them was — which is the test every badge here has to
	// pass. Nothing is counted from a private save or from a login.
	const BADGE_LABELS: Record<OpponentBadge, string> = {
		active_this_week: "Active this week",
		new_here: "New here",
	};

	// The card's badge row: the pair's history first, then the opponent's own
	// badges.
	//
	// Every history label names the pair, never the player. "Never played" under
	// a stranger's name reads as a fact about them — that they have never played
	// at all — which is both wrong and the opposite of a recommendation.
	// "First meeting" can only be about the two of you.
	function labelsFor(o: RecommendedOpponent): string[] {
		const history =
			o.meetings === 0
				? "First meeting"
				: o.meetings === 1
					? "Played once"
					: o.meetings === 2
						? "Played twice"
						: `Played ${o.meetings} times`;
		return [history, ...o.badges.map((b) => BADGE_LABELS[b])];
	}
</script>

{#snippet opponentCard(o: RecommendedOpponent)}
	<!-- Bottom-aligned, not centred: the badge row is the last thing in the
	     identity column, so its baseline is the column's bottom edge — ending the
	     row there puts the Discord chip on the same line as the badges. And
	     wrapping, because the chip is shrink-0 and the identity column is
	     not: on a card too narrow for both, an unwrapped row spends its width
	     on the chip and leaves the column a name clipped to a few characters
	     and a badge broken across two lines. Wrapped, the chip takes its own
	     line below and the name gets the card. Which card that is depends on
	     the column count as much as the screen — a phone and a three-column
	     desktop grid are about the same width — so the break is left to the
	     content rather than pinned to a breakpoint. -->
	<div class="flex flex-wrap items-end gap-2 rounded-lg bg-surface p-3">
		<!-- Identity: the avatar and the name link, and nothing else in the card
		     does — the badges state facts about the pair, so they are not a way to
		     reach anyone. Two anchors rather than one around the pair, because the
		     badges sit under the name and inside that anchor they would be
		     clickable too. The Discord link is their sibling, not a child: an
		     anchor inside an anchor is not markup.

		     The basis is the wrap threshold, so it is set from the chip and not
		     from the name: chip (157px) plus gap (8px) is 165px, so a card with
		     less than basis + 165px inside its padding keeps the two on one
		     line and pays for it out of the name. The narrowest card the grid
		     below makes is the xl column at a 1280 viewport: the page's px-4,
		     the tab panel's p-4 and the scroll gutter leave 1211px for three
		     columns and two gaps, so the column is 396px and 372 inside the
		     card's own padding — which leaves 207px for this column. basis-56
		     (224) is comfortably past that, so there the chip drops to its own
		     line instead of clipping the name to ~154px; from 1333px up the
		     column has the 389px both need and this changes nothing. Measured,
		     not derived: the chain above is easy to get wrong by one wrapper.
		     min-w-0 keeps the truncate working on the line where the column is
		     alone. -->
		<div class="flex min-w-0 grow basis-56 items-center gap-3">
			<ProfileLink
				userId={o.user_id}
				slug={o.slug}
				class="shrink-0"
				ariaLabel="{o.display_name}'s profile"
			>
				<img
					src={o.avatar_url}
					alt=""
					width="40"
					height="40"
					class="h-10 w-10 shrink-0 rounded-full border-2 border-black transition-colors hover:border-orange"
				/>
			</ProfileLink>

			<div class="min-w-0 flex-1">
				<!-- inline-block, so the hit area and the hover underline stop at the
				     end of the name instead of running the column's full width. -->
				<ProfileLink
					userId={o.user_id}
					slug={o.slug}
					class="inline-block max-w-full truncate align-bottom text-base font-bold text-white hover:underline"
					title="{o.display_name}'s profile"
				>
					{o.display_name}
				</ProfileLink>

				<div class="mt-1 flex flex-wrap items-center gap-1.5">
					{#each labelsFor(o) as label (label)}
						<span
							class="rounded bg-amber-700/40 px-1.5 py-0.5 text-xs text-amber-300"
						>
							{label}
						</span>
					{/each}
				</div>
			</div>
		</div>

		<!-- Their Discord profile, in the blurple the home page signs in with —
		     same brand call to action, so the one Discord control on a page always
		     looks like the others. It opens their profile, not a compose box:
		     Discord publishes no DM URL, and whether a stranger may message them
		     at all stays their privacy setting to make. The tooltip names whose
		     profile it is, which the shared label can't. Half again the badges'
		     height: text-xs and the default 16px mark set a 16px line box, and 7px
		     of pad above and below take it to 30px against their 20px. Bottom
		     alignment is what keeps it readable — the chip grows upward, so it
		     still sits on the badge line rather than floating off it.
		     discord.com, not an app route, so resolve() doesn't apply; rel guards
		     tabnabbing + referrer leakage (same shape as VideoCard's). -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			href={o.discord_url}
			target="_blank"
			rel="noopener noreferrer"
			class="inline-flex shrink-0 items-center gap-1.5 rounded bg-[#5865F2] px-2 py-[7px] text-xs font-semibold text-white transition-colors hover:bg-[#4752c4]"
			title="{o.display_name} on Discord"
		>
			<DiscordMark />
			Message on Discord
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>
{/snippet}

<!-- The tab bar says "Suggested"; this says what of. Only above an actual
     list: each empty state already names what the list would have been, so
     the frame there would announce players that aren't on the page. -->
{#if opponents.length > 0}
	<p class="mb-3 text-sm text-tan opacity-90">
		Players who should give you a close game.
	</p>
{/if}

{#if !openToMatches}
	<p class="mb-3 text-sm text-tan opacity-70">
		You're hidden from other players' lists —
		<a
			href={resolve("/account")}
			class="text-orange transition-colors hover:text-tan">Settings</a
		> to be listed too.
	</p>
{/if}

{#if opponents.length > 0}
	<!-- Third column at xl, not lg like the video grid: these cards are
	     horizontal, and a narrow column drops the Discord chip onto its own
	     line. That is a fair card and not a broken one, but three per row
	     reads best when it doesn't happen, and from 1333px up the column is
	     wide enough that it doesn't — on its way to the ~430px the card was
	     laid out at, back when the list was its own max-w-4xl page. At 1280
	     exactly the column is 396px and the chip does wrap, which is the case
	     the basis above is set for. -->
	<div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
		{#each opponents as o (o.user_id)}
			{@render opponentCard(o)}
		{/each}
	</div>
{:else if !suggestions.rated}
	<p class="p-8 text-center text-sm text-tan opacity-60">
		Suggestions come from your multiplayer games.
		<a
			href={resolve("/upload")}
			class="text-orange transition-colors hover:text-tan">Upload a save</a
		> of one you've played and you'll have a list.
	</p>
{:else}
	<p class="p-8 text-center text-sm text-tan opacity-60">
		Nothing to suggest right now — there's nobody else both listed and around at
		the moment.
	</p>
{/if}

<!-- The tab bar gives this tab no mark of its own, so the answer to "who else
     sees this?" lives here: under the list, in every state, because it is as
     true of an empty page as of a full one. -->
<p class="mt-4 text-right text-xs text-tan opacity-60">
	Opponent recommendations are private.
</p>
