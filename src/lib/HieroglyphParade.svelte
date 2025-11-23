<script lang="ts">
  import { onDestroy } from "svelte";

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
  const PARADE_DURATION = 20; // seconds to cross the screen
  const SPAWN_INTERVAL = 1000; // spawn a new character every 1 second

  interface ParadeItem {
    id: number;
    char: string;
  }

  let items = $state<ParadeItem[]>([]);
  let nextId = 0;
  let spawnInterval: ReturnType<typeof setInterval> | null = null;

  // Spawn a new hieroglyph
  function spawnHieroglyph() {
    const char = HIEROGLYPHS[Math.floor(Math.random() * HIEROGLYPHS.length)];
    const item: ParadeItem = {
      id: nextId++,
      char,
    };
    items = [...items, item];

    // Remove item after animation completes
    setTimeout(
      () => {
        items = items.filter((i) => i.id !== item.id);
      },
      PARADE_DURATION * 1000 + 1000
    );
  }

  function startParade() {
    // Spawn initial batch with staggered delays to fill the screen
    for (let i = 0; i < 12; i++) {
      setTimeout(
        () => {
          if (active) spawnHieroglyph();
        },
        i * SPAWN_INTERVAL
      );
    }

    // Continue spawning to maintain the parade
    spawnInterval = setInterval(() => {
      if (active) {
        spawnHieroglyph();
      }
    }, SPAWN_INTERVAL);
  }

  function stopParade() {
    if (spawnInterval) {
      clearInterval(spawnInterval);
      spawnInterval = null;
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

<div class="parade-container">
  {#each items as item (item.id)}
    <span class="parade-item">
      {item.char}
    </span>
  {/each}
</div>

<style>
  .parade-container {
    position: absolute;
    top: 0.75rem;
    left: 0;
    right: 0;
    height: 2.5rem;
    overflow: hidden;
    pointer-events: none;
    z-index: 10;
    display: flex;
    align-items: center;
  }

  .parade-item {
    position: absolute;
    font-size: 1.25rem;
    color: var(--color-tan);
    opacity: 0.9;
    /* Smooth linear animation */
    animation: parade-march 20s linear forwards;
    /* Start from right edge, off-screen */
    right: -2.5rem;
    white-space: nowrap;
    line-height: 1;
  }

  @keyframes parade-march {
    0% {
      transform: translateX(0);
    }
    100% {
      /* Move from right edge to left edge plus buffer */
      transform: translateX(calc(-100vw - 5rem));
    }
  }
</style>
