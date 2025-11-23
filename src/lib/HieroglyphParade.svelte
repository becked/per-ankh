<script lang="ts">
  import { onDestroy, untrack } from "svelte";

  interface Props {
    active: boolean;
  }

  let { active }: Props = $props();

  // Curated hieroglyphs: people, animals, deities, and interesting figures
  // From Unicode block U+13000-U+1342F (Egyptian Hieroglyphs)
  const HIEROGLYPHS = [
    // People and figures (seated, standing, walking poses)
    "\u{13000}", // seated man
    "\u{13001}", // man with hand to mouth
    "\u{13002}", // man with arms raised
    "\u{13003}", // man with arms forward
    "\u{13004}", // man with stick
    "\u{13005}", // man kneeling
    "\u{13006}", // man kneeling with arms raised
    "\u{13007}", // man with basket on head
    "\u{1300D}", // man dancing
    "\u{13010}", // man falling
    "\u{13014}", // man building wall
    "\u{1301F}", // soldier
    // Women
    "\u{13026}", // seated woman
    "\u{13027}", // standing woman
    "\u{13028}", // woman dancing
    // Deities and crowned figures
    "\u{13040}", // seated deity
    "\u{13041}", // seated god with scepter
    "\u{13042}", // seated goddess
    "\u{13050}", // god with was-scepter
    // Birds
    "\u{13170}", // egyptian vulture
    "\u{13171}", // vulture
    "\u{13183}", // owl
    "\u{1317D}", // falcon
    "\u{1317E}", // falcon on standard
    "\u{13184}", // duck
    "\u{13185}", // flying duck
    "\u{1319D}", // ibis
    // Animals
    "\u{130ED}", // ox
    "\u{130F2}", // horse
    "\u{130FF}", // pig
    "\u{13100}", // cat
    "\u{13102}", // dog
    "\u{13103}", // jackal
    "\u{130A4}", // elephant
    "\u{130A5}", // giraffe
    "\u{130A7}", // hippopotamus
    "\u{13153}", // crocodile
    "\u{1312D}", // lion
    "\u{1312F}", // lion lying down
    "\u{13123}", // hare
    // Snakes
    "\u{13193}", // cobra
    "\u{13194}", // horned viper
    // Fish
    "\u{131B5}", // tilapia
    "\u{131BC}", // fish
  ];

  // Fixed parade timing - all characters move together at same speed
  const PARADE_DURATION_MS = 20000; // milliseconds to cross the screen
  const SPAWN_INTERVAL_MS = 1000; // spawn a new character every 1 second

  interface ParadeItem {
    id: number;
    char: string;
    spawnTime: number; // when this item was spawned (for removal timing)
    animationDelay: number; // CSS animation-delay in seconds (negative = start partway through)
  }

  let items = $state<ParadeItem[]>([]);
  let nextId = 0;
  let animationFrameId: number | null = null;
  let nextSpawnTime = 0;
  let isRunning = false; // Non-reactive flag for RAF loop

  // Schedule removal for an item
  function scheduleRemoval(id: number, animationDelay: number) {
    const remainingDuration = PARADE_DURATION_MS + animationDelay * 1000 + 1000;
    setTimeout(() => {
      items = items.filter((i) => i.id !== id);
    }, Math.max(remainingDuration, 100));
  }

  // Spawn a new hieroglyph and schedule its removal
  function spawnHieroglyph(animationDelay: number = 0) {
    const char = HIEROGLYPHS[Math.floor(Math.random() * HIEROGLYPHS.length)];
    const id = nextId++;
    const item: ParadeItem = {
      id,
      char,
      spawnTime: performance.now(),
      animationDelay,
    };
    items = [...items, item];
    scheduleRemoval(id, animationDelay);
  }

  // Main animation loop - only handles spawn timing
  // Uses non-reactive isRunning flag to avoid effect loops
  function animate(currentTime: number) {
    if (!isRunning) return;

    // Spawn new items when it's time
    if (currentTime >= nextSpawnTime) {
      untrack(() => spawnHieroglyph());
      nextSpawnTime = currentTime + SPAWN_INTERVAL_MS;
    }

    animationFrameId = requestAnimationFrame(animate);
  }

  function startParade() {
    // Reset state
    nextId = 0;
    isRunning = true;

    const now = performance.now();

    // Pre-spawn items to fill the screen immediately
    // Build array first, then assign once to avoid multiple reactive updates
    const itemsToPreSpawn = Math.ceil(PARADE_DURATION_MS / SPAWN_INTERVAL_MS);
    const initialItems: ParadeItem[] = [];

    for (let i = 0; i < itemsToPreSpawn; i++) {
      // Calculate how "old" this item should appear
      // First item (i=0) is oldest, last item (i=itemsToPreSpawn-1) is newest
      const ageMs = (itemsToPreSpawn - 1 - i) * SPAWN_INTERVAL_MS;
      const animationDelay = -ageMs / 1000; // Convert to negative seconds
      const char = HIEROGLYPHS[Math.floor(Math.random() * HIEROGLYPHS.length)];
      const id = nextId++;

      initialItems.push({
        id,
        char,
        spawnTime: now,
        animationDelay,
      });

      // Schedule removal for each pre-spawned item
      scheduleRemoval(id, animationDelay);
    }

    // Single state update with all initial items
    items = initialItems;

    // Set next spawn time for future items
    nextSpawnTime = now + SPAWN_INTERVAL_MS;

    // Start animation loop
    animationFrameId = requestAnimationFrame(animate);
  }

  function stopParade() {
    isRunning = false;
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  // React to active prop changes
  $effect(() => {
    if (active) {
      startParade();
    } else {
      stopParade();
    }
  });

  onDestroy(() => {
    stopParade();
  });
</script>

<!-- Static hieroglyph border above parade -->
<div class="hieroglyph-border hieroglyph-border-top">𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹</div>

<div class="parade-container">
  {#each items as item (item.id)}
    <span class="parade-item" style="animation-delay: {item.animationDelay}s">
      {item.char}
    </span>
  {/each}
</div>

<!-- Static hieroglyph border below parade -->
<div class="hieroglyph-border">𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹𓉹</div>

<style>
  .parade-container {
    position: absolute;
    top: 2.1rem;
    left: 0;
    right: 0;
    height: 2.4rem;
    overflow: hidden;
    pointer-events: none;
    z-index: 10;
    display: flex;
    align-items: center;
  }

  .parade-item {
    position: absolute;
    font-size: 1.2rem;
    color: var(--color-tan);
    opacity: 0.9;
    /* Smooth linear animation */
    animation: parade-march 20s linear forwards;
    /* Start from right edge, off-screen */
    right: -2.4rem;
    white-space: nowrap;
    line-height: 1;
  }

  @keyframes parade-march {
    0% {
      transform: translateX(0);
    }
    100% {
      /* Move from right edge to left edge plus buffer */
      transform: translateX(calc(-100vw - 4.8rem));
    }
  }

  .hieroglyph-border {
    position: absolute;
    top: 4.5rem;
    left: 1rem;
    right: 1rem;
    font-size: 0.5rem;
    color: var(--color-tan);
    opacity: 0.7;
    white-space: nowrap;
    overflow: hidden;
    pointer-events: none;
    z-index: 10;
    letter-spacing: 0.15em;
    line-height: 1;
  }

  .hieroglyph-border-top {
    top: 1.65rem;
  }
</style>
