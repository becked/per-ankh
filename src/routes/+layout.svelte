<script lang="ts">
  import "../app.css";
  import GameSidebar from "$lib/GameSidebar.svelte";
  import { page } from "$app/stores";
  import { fade } from "svelte/transition";
</script>

<div class="flex h-screen overflow-hidden bg-blue-gray border-8 border-border-gray relative">
  <!-- Window drag region - accounts for border-8 (2rem) offset -->
  <div data-tauri-drag-region class="absolute top-0 left-0 right-0 h-12" style="z-index: 9999; pointer-events: auto;"></div>

  <GameSidebar />
  {#key $page.url.pathname}
    <div class="flex-1 flex flex-col min-w-0" in:fade={{ duration: 150, delay: 150 }} out:fade={{ duration: 150 }}>
      <slot />
    </div>
  {/key}
</div>
