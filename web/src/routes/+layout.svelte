<script>
	import "../app.css";
	let { children } = $props();
</script>

<div class="flex h-screen flex-col overflow-hidden bg-blue-gray">
	{@render children()}
</div>
