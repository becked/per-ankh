<script lang="ts">
  import GameTabs from "$lib/GameTabs.svelte";
  import { page } from "$app/stores";
  import { fade } from "svelte/transition";
</script>

<div class="app-layout">
  <GameTabs />
  {#key $page.url.pathname}
    <div class="page-wrapper" in:fade={{ duration: 150, delay: 150 }} out:fade={{ duration: 150 }}>
      <slot />
    </div>
  {/key}
</div>

<style>
  .app-layout {
    display: flex;
    height: 100vh;
    overflow: hidden;
    background: var(--color-blue-gray);
  }

  .page-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
</style>
