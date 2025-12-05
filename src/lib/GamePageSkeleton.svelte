<!-- Skeleton loading state for the game page -->
<!-- Matches the layout of +page.svelte exactly to prevent layout shift -->

<main class="flex-1 pt-4 px-4 pb-8 overflow-y-auto bg-blue-gray isolate">
  <!-- Header with title and date - exact same classes as real page -->
  <div class="flex justify-between items-baseline mb-8">
    <h1 class="text-gray-200 text-3xl font-bold invisible">Game Title Here</h1>
    <p class="text-brown text-sm invisible">Nov 22, 2024</p>
  </div>

  <!-- Summary Section - use fixed min-widths to prevent layout shift -->
  <div class="p-2 border-2 border-black rounded-lg mb-6" style="background-color: #36302a;">
    <div class="flex justify-evenly">
      <!-- Left Column: Player, Winner & Victory Type -->
      <div class="grid grid-cols-[auto_minmax(180px,1fr)] gap-x-2 gap-y-2 items-center">
        <span class="font-bold text-brown text-xs uppercase tracking-wide text-right">Player:</span>
        <span class="text-xl font-bold invisible" style="color: #EEEEEE;">X</span>

        <span class="font-bold text-brown text-xs uppercase tracking-wide text-right">Winner:</span>
        <span class="text-xl font-bold invisible" style="color: #EEEEEE;">X</span>

        <span class="font-bold text-brown text-xs uppercase tracking-wide text-right">Victory Type:</span>
        <span class="text-xl font-bold invisible" style="color: #EEEEEE;">X</span>
      </div>

      <!-- Right Column: Map, Turns & Nations -->
      <div class="grid grid-cols-[auto_minmax(100px,1fr)] gap-x-2 gap-y-2 items-center">
        <span class="font-bold text-brown text-xs uppercase tracking-wide text-right">Map:</span>
        <span class="text-xl font-bold invisible" style="color: #EEEEEE;">X</span>

        <span class="font-bold text-brown text-xs uppercase tracking-wide text-right">Turns:</span>
        <span class="text-xl font-bold invisible" style="color: #EEEEEE;">X</span>

        <span class="font-bold text-brown text-xs uppercase tracking-wide text-right">Nations:</span>
        <span class="text-xl font-bold invisible" style="color: #EEEEEE;">X</span>
      </div>
    </div>
  </div>

  <!-- Tab Navigation - exact same text and classes as real tabs -->
  <div class="flex">
    <div class="px-6 py-3 border-2 border-black border-b-0 border-r-0 rounded-tl-lg font-bold text-tan" style="background-color: #35302B;">
      Events
    </div>
    <div class="px-6 py-3 border-2 border-black border-b-0 border-r-0 font-bold text-tan" style="background-color: #2a2622;">
      Laws & Technology
    </div>
    <div class="px-6 py-3 border-2 border-black border-b-0 border-r-0 font-bold text-tan" style="background-color: #2a2622;">
      Economics
    </div>
    <div class="px-6 py-3 border-2 border-black border-b-0 border-r-0 font-bold text-tan" style="background-color: #2a2622;">
      Cities
    </div>
    <div class="px-6 py-3 border-2 border-black border-b-0 border-r-0 font-bold text-tan" style="background-color: #2a2622;">
      Map
    </div>
    <div class="px-6 py-3 border-2 border-black border-b-0 rounded-tr-lg font-bold text-tan" style="background-color: #2a2622;">
      Game Settings
    </div>
  </div>

  <!-- Tab Content area -->
  <div class="p-8 border-2 border-black border-t-0 rounded-b-lg min-h-[400px]" style="background-color: #35302B;">
  </div>
</main>
