<script>
	import "../app.css";
	let { children } = $props();
</script>

<div class="flex h-screen flex-col overflow-hidden bg-blue-gray">
	<header class="flex items-center justify-between border-b border-black bg-[#1a1714] px-4 py-1.5">
		<a href="https://per-ankh.app" class="text-sm font-semibold text-tan hover:text-orange">
			Per Ankh
		</a>
		<div class="flex items-center gap-3">
			<span class="text-xs text-brown">Old World Game Analytics</span>
			<a href="https://github.com/becked/per-ankh/releases/latest" class="rounded border border-brown/30 px-2 py-0.5 text-xs text-tan transition-colors hover:border-orange hover:text-orange">
				Download
			</a>
		</div>
	</header>
	{@render children()}
</div>
