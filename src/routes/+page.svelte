<script lang="ts">
	import { resolve } from "$app/paths";
</script>

<div class="flex min-h-screen flex-col bg-blue-gray">
	<main class="flex flex-1 flex-col items-center justify-center px-4">
		<h1 class="mb-2 text-4xl font-bold text-gray-200">𓉑 Per Ankh</h1>
		<p class="text-lg text-brown">Old World Game Analytics</p>
		<p class="mt-6 max-w-md text-center text-sm text-brown">
			Per Ankh visualizes data from your Old World game saves.
		</p>
		<a
			href={resolve("/login")}
			class="mt-6 rounded border border-brown/30 px-4 py-2 text-sm text-tan transition-colors hover:border-orange hover:text-orange"
		>
			Sign in to get started
		</a>
	</main>
	<footer class="border-t border-black bg-[#1a1714] px-4 py-2 text-center text-[11px] text-brown">
		Per Ankh is an unofficial fan tool. Old World and all related assets © Mohawk Games. Not affiliated with or endorsed by Mohawk Games.
	</footer>
</div>
