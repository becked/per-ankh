<script lang="ts">
  import "../app.css";
  import Header from "$lib/Header.svelte";
  import GameSidebar from "$lib/GameSidebar.svelte";
  import { page } from "$app/stores";
  import { fade } from "svelte/transition";
</script>

<div class="flex flex-col h-screen overflow-hidden bg-blue-gray border-8 border-border-gray">
  <Header />

  <div class="flex flex-1 overflow-hidden">
    <GameSidebar />
    {#key $page.url.pathname}
      <div class="flex-1 flex flex-col min-w-0" in:fade={{ duration: 150, delay: 150 }} out:fade={{ duration: 150 }}>
        <slot />
      </div>
    {/key}
  </div>
</div>
