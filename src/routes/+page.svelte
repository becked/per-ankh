<script lang="ts">
	// Dual-build root. Tauri sees the desktop overview dashboard; cloud sees
	// a minimal marketing landing. The Tauri-bound imports live entirely
	// inside HomeDashboard.svelte so Vite DCEs the import on cloud builds
	// where `__BUILD_TARGET__ === "cloud"` is a static literal.
	// Phase F1 (Tauri sweep) collapses this back to the cloud branch only.
	import HomeDashboard from "$lib/desktop/HomeDashboard.svelte";
</script>

{#if __BUILD_TARGET__ === "cloud"}
	<div class="flex min-h-screen flex-col bg-blue-gray">
		<main class="flex flex-1 flex-col items-center justify-center px-4">
			<h1 class="mb-2 text-4xl font-bold text-gray-200">𓉑 Per Ankh</h1>
			<p class="text-lg text-brown">Old World Game Analytics</p>
			<p class="mt-6 max-w-md text-center text-sm text-brown">
				Per Ankh is a desktop app that visualizes your Old World game data.
				Shared game links appear at <code class="text-tan">/share/[id]</code>.
			</p>
			<a
				href="https://github.com/becked/per-ankh/releases/latest"
				class="mt-6 rounded border border-brown/30 px-4 py-2 text-sm text-tan transition-colors hover:border-orange hover:text-orange"
			>
				Download Latest Release
			</a>
		</main>
		<footer class="border-t border-black bg-[#1a1714] px-4 py-2 text-center text-[11px] text-brown">
			Per Ankh is an unofficial fan tool. Old World and all related assets © Mohawk Games. Not affiliated with or endorsed by Mohawk Games.
		</footer>
	</div>
{:else}
	<HomeDashboard />
{/if}
