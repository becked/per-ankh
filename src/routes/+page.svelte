<script lang="ts">
	import { resolve } from "$app/paths";
</script>

<div class="flex min-h-screen flex-col bg-blue-gray">
	<!--
		Stripped-down header for the public landing: centered wordmark only,
		no hamburger / search. Matches /login and /auth/callback so the whole
		unauthenticated surface feels continuous.
	-->
	<header
		class="flex w-full shrink-0 items-center justify-center border-b-[3px] border-black bg-blue-gray px-4 pb-2 pt-6"
	>
		<div class="border-b-2 border-orange pb-1 text-3xl font-bold text-gray-200">
			𓉑 Per Ankh
		</div>
	</header>

	<main class="flex flex-1 items-center justify-center p-4">
		<div class="w-full max-w-sm rounded-lg p-4" style="background-color: #2a2622;">
			<h3 class="mb-3 text-base font-bold text-tan">
				Old World Save Analytics
			</h3>
			<div class="rounded-lg p-3" style="background-color: #35302B;">
				<p class="mb-3 text-xs text-gray-400">
					Data visualization &amp; analytics
				</p>
				<a
					href={resolve("/login")}
					class="block w-full rounded bg-brown px-3 py-1.5 text-center text-xs text-tan hover:bg-orange"
				>
					Login
				</a>
			</div>
		</div>
	</main>

	<footer
		class="border-t border-black bg-[#1a1714] px-4 py-2 text-center text-[11px] text-brown"
	>
		Per Ankh is an unofficial fan tool. Old World and all related assets © Mohawk Games. Not affiliated with or endorsed by Mohawk Games.
	</footer>
</div>
