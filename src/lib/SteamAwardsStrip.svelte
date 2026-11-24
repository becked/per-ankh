<script lang="ts">
	// A site-wide strip under the header that asks visitors to nominate Old World
	// for the Labor of Love award in the 2026 Steam Awards. It hides itself when
	// nominations close. A visitor can close it sooner, and that choice is kept
	// in a preference cookie.
	import { onMount } from "svelte";
	import { nowMs } from "$lib/stores/now.svelte";
	import { readPrefCookie, writePrefCookie } from "$lib/utils/pref-cookie";

	// Nominations close November 30, 2026 at 10:00 PST, which is 18:00 UTC.
	const CLOSES_AT_MS = Date.parse("2026-11-30T18:00:00Z");
	const NOMINATE_URL =
		"https://store.steampowered.com/steamawards/nominations/2026?snr=1_4_4__118&snr=1_4_4__118";
	const IMAGE_URL =
		"https://cdn.akamai.steamstatic.com/store/promo/steamawards2026/sa2026_header_static.webp";
	const COOKIE = "pa_steam_awards_2026";

	// Starts hidden, so the server never renders the strip. The cookie can only
	// be read in the browser. If the server rendered the strip, a visitor who
	// had closed it would see it flash on every full page load.
	let dismissed = $state(true);

	onMount(() => {
		dismissed = readPrefCookie(COOKIE) === "dismissed";
	});

	// nowMs() ticks every 30 seconds, so a tab left open removes the strip when
	// nominations close.
	const visible = $derived(!dismissed && nowMs() < CLOSES_AT_MS);

	function dismiss(): void {
		dismissed = true;
		writePrefCookie(COOKIE, "dismissed");
	}
</script>

{#if visible}
	<!-- The dismiss button is positioned absolutely so the image and text center
	     on the full bar width. The equal px-10 keeps text clear of the button. -->
	<div
		class="relative flex shrink-0 items-center justify-center gap-3 border-b border-black bg-surface-raised px-10 py-1.5 text-sm"
	>
		<!-- One link around the image and the text, so they are a single tab stop. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -- external site, not an app route; rel guards tabnabbing + referrer leakage -->
		<a
			href={NOMINATE_URL}
			target="_blank"
			rel="noopener noreferrer"
			class="group flex min-w-0 items-center gap-3 font-semibold text-orange"
		>
			<!-- width/height reserve the image's aspect ratio so the row doesn't
			     resize when it loads. -->
			<img
				src={IMAGE_URL}
				alt=""
				width="2000"
				height="765"
				class="h-8 w-auto shrink-0"
			/>
			<span class="min-w-0 group-hover:underline">
				Nominate <span class="text-gray-200">Old World</span> for the Labor of Love
				award in the 2026 Steam Awards
			</span>
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
		<button
			type="button"
			class="absolute right-4 top-1/2 -translate-y-1/2 px-1 text-lg leading-none text-tan opacity-60 hover:opacity-100"
			aria-label="Dismiss"
			onclick={dismiss}
		>
			×
		</button>
	</div>
{/if}
