<script lang="ts">
  import "../app.css";
  import GameTabs from "$lib/GameTabs.svelte";
  import { page } from "$app/stores";
  import { fade } from "svelte/transition";
</script>

<div class="flex h-screen overflow-hidden bg-blue-gray border-8 border-border-gray">
  <GameTabs />
  {#key $page.url.pathname}
    <div class="flex-1 flex flex-col min-w-0" in:fade={{ duration: 150, delay: 150 }} out:fade={{ duration: 150 }}>
      <slot />
    </div>
  {/key}
</div>
