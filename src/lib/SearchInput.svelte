<script lang="ts">
	let {
		value = $bindable(""),
		placeholder = "Search",
		variant = "light",
		class: className = "",
	}: {
		value?: string;
		placeholder?: string;
		variant?: "light" | "dark" | "field";
		class?: string;
	} = $props();

	const variantStyles = {
		light: {
			icon: "text-gray-400",
			input: "py-2 border-2 border-black rounded bg-white text-black text-sm",
			bg: "",
		},
		dark: {
			icon: "text-tan opacity-50",
			input:
				"py-1 border-none rounded-full text-tan text-sm font-normal placeholder-tan placeholder:opacity-50",
			bg: "background-color: #403A33;",
		},
		field: {
			icon: "text-brown",
			input:
				"py-2 border-2 border-black rounded text-tan text-sm placeholder-brown placeholder:opacity-70",
			bg: "background-color: #201a13;",
		},
	};

	const styles = $derived(variantStyles[variant]);
</script>

<div class="relative {className}">
	<div class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="h-4 w-4 {styles.icon}"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
			/>
		</svg>
	</div>
	<input
		type="text"
		bind:value
		{placeholder}
		autocomplete="off"
		autocorrect="off"
		autocapitalize="off"
		spellcheck="false"
		class="w-full pl-9 pr-3 {styles.input} transition-colors focus:outline-none"
		style={styles.bg}
	/>
</div>
