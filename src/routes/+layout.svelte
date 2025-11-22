<script lang="ts">
  import "../app.css";
  import Header from "$lib/Header.svelte";
  import GameSidebar from "$lib/GameSidebar.svelte";
</script>

<div class="flex flex-col h-screen overflow-hidden bg-blue-gray border-8 border-border-gray">
  <Header />

  <div class="flex flex-1 overflow-hidden">
    <div class="flex-1 flex flex-col min-w-0">
      <slot />
    </div>
    <GameSidebar />
  </div>
</div>
