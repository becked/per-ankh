<script lang="ts">
  let {
    value = $bindable(""),
    placeholder = "Search",
    variant = "light",
    class: className = ""
  }: {
    value?: string;
    placeholder?: string;
    variant?: "light" | "dark";
    class?: string;
  } = $props();
</script>

<div class="relative {className}">
  <div class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class="h-4 w-4 {variant === 'dark' ? 'text-tan opacity-50' : 'text-gray-400'}"
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
    class="w-full pl-9 pr-3 {variant === 'dark'
      ? 'py-1 border-none rounded-full text-tan text-sm font-normal placeholder-tan placeholder:opacity-50'
      : 'py-2 border-2 border-black rounded bg-white text-black text-sm'} focus:outline-none transition-colors"
    style={variant === 'dark' ? 'background-color: #403A33;' : ''}
  />
</div>
