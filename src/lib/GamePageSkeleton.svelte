<!-- Skeleton loading state for the game page -->
<!-- Matches the layout of +page.svelte exactly to prevent layout shift -->

<main class="isolate flex-1 overflow-y-auto bg-blue-gray px-4 pb-8 pt-4">
	<!-- Header with title and date - exact same classes as real page -->
	<div class="mb-8 flex items-baseline justify-between">
		<h1 class="invisible text-3xl font-bold text-gray-200">Game Title Here</h1>
		<p class="invisible text-sm text-brown">Nov 22, 2024</p>
	</div>

	<!-- Summary Section - use fixed min-widths to prevent layout shift -->
	<div
		class="mb-6 rounded-lg border-2 border-black p-2"
		style="background-color: #36302a;"
	>
		<div class="flex justify-evenly">
			<!-- Left Column: Player, Winner & Victory Type -->
			<div
				class="grid grid-cols-[auto_minmax(180px,1fr)] items-center gap-x-2 gap-y-2"
			>
				<span
					class="text-right text-xs font-bold uppercase tracking-wide text-brown"
					>Player:</span
				>
				<span class="invisible text-xl font-bold" style="color: #EEEEEE;"
					>X</span
				>

				<span
					class="text-right text-xs font-bold uppercase tracking-wide text-brown"
					>Winner:</span
				>
				<span class="invisible text-xl font-bold" style="color: #EEEEEE;"
					>X</span
				>

				<span
					class="text-right text-xs font-bold uppercase tracking-wide text-brown"
					>Victory Type:</span
				>
				<span class="invisible text-xl font-bold" style="color: #EEEEEE;"
					>X</span
				>
			</div>

			<!-- Right Column: Map, Turns & Nations -->
			<div
				class="grid grid-cols-[auto_minmax(100px,1fr)] items-center gap-x-2 gap-y-2"
			>
				<span
					class="text-right text-xs font-bold uppercase tracking-wide text-brown"
					>Map:</span
				>
				<span class="invisible text-xl font-bold" style="color: #EEEEEE;"
					>X</span
				>

				<span
					class="text-right text-xs font-bold uppercase tracking-wide text-brown"
					>Turns:</span
				>
				<span class="invisible text-xl font-bold" style="color: #EEEEEE;"
					>X</span
				>

				<span
					class="text-right text-xs font-bold uppercase tracking-wide text-brown"
					>Nations:</span
				>
				<span class="invisible text-xl font-bold" style="color: #EEEEEE;"
					>X</span
				>
			</div>
		</div>
	</div>

	<!-- Tab Navigation - exact same text and classes as real tabs -->
	<div class="flex">
		<div
			class="rounded-tl-lg border-2 border-b-0 border-r-0 border-black px-6 py-3 font-bold text-tan"
			style="background-color: #35302B;"
		>
			Events
		</div>
		<div
			class="border-2 border-b-0 border-r-0 border-black px-6 py-3 font-bold text-tan"
			style="background-color: #2a2622;"
		>
			Laws
		</div>
		<div
			class="border-2 border-b-0 border-r-0 border-black px-6 py-3 font-bold text-tan"
			style="background-color: #2a2622;"
		>
			Techs
		</div>
		<div
			class="border-2 border-b-0 border-r-0 border-black px-6 py-3 font-bold text-tan"
			style="background-color: #2a2622;"
		>
			Yields
		</div>
		<div
			class="border-2 border-b-0 border-r-0 border-black px-6 py-3 font-bold text-tan"
			style="background-color: #2a2622;"
		>
			Military
		</div>
		<div
			class="border-2 border-b-0 border-r-0 border-black px-6 py-3 font-bold text-tan"
			style="background-color: #2a2622;"
		>
			Cities
		</div>
		<div
			class="border-2 border-b-0 border-r-0 border-black px-6 py-3 font-bold text-tan"
			style="background-color: #2a2622;"
		>
			Improvements
		</div>
		<div
			class="border-2 border-b-0 border-r-0 border-black px-6 py-3 font-bold text-tan"
			style="background-color: #2a2622;"
		>
			Map
		</div>
		<div
			class="rounded-tr-lg border-2 border-b-0 border-black px-6 py-3 font-bold text-tan"
			style="background-color: #2a2622;"
		>
			Game Settings
		</div>
	</div>

	<!-- Tab Content area -->
	<div
		class="min-h-[400px] rounded-b-lg border-2 border-t-0 border-black p-8"
		style="background-color: #35302B;"
	></div>
</main>
