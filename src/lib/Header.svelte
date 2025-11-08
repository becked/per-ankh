<script lang="ts">
  import { goto } from "$app/navigation";

  function navigateToSummary() {
    goto("/");
  }
</script>

<header
  data-tauri-drag-region
  class="w-full bg-blue-gray border-b-[3px] border-black px-4 pt-6 pb-2 flex items-center"
>
  <button
    class="cursor-pointer text-left transition-opacity hover:opacity-80"
    type="button"
    onclick={navigateToSummary}
  >
    <div class="text-3xl font-bold text-gray-200 border-b-2 border-orange pb-1">☥ Per Ankh</div>
  </button>
</header>
