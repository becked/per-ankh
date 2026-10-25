// The tab components a game's analysis loads on demand. Imported statically
// they all land in the /games/[id] route chunk, so every visitor downloaded
// all fourteen tabs to read the one or two they open (#178) — each entry below
// is its own chunk instead, fetched when its tab is first opened.
//
// Overview is deliberately absent and stays a static import in GameTab: it is
// the tab both views open on and the only one SSR renders, so deferring it
// would replace a server-rendered pane with a loading state and charge a round
// trip before the page said anything.
import { deferred, type Deferred } from "$lib/deferred.svelte";
import type { GameTabId } from "./game-tabs.svelte";

// Every tab but Overview.
type LazyTabId = Exclude<GameTabId, "overview">;

// One tab's chunk and what it resolved to — the component, which is the
// module's default export. Each slot keeps its own component type, inferred
// from its own `import()`: one shared component type across the thirteen would
// accept any props at all, and a prop a tab never received is exactly the
// defect that would hide behind it.
//
// The slots below are module-level, so the two views that render tabs — the
// analyst view's panes and the map view's lightboxes — share one copy of each:
// a tab opened a second time renders with no loading state at all.
function deferredTab<T>(load: () => Promise<{ default: T }>): Deferred<T> {
	return deferred(() => load().then((module) => module.default));
}

// Keyed by tab id, which is not the component's name for every tab — the
// Yields tab's id is `economics` (see GameTabId). `satisfies` is what makes a
// new tab id a type error here rather than a tab that renders nothing.
export const LAZY_TABS = {
	events: deferredTab(() => import("./EventsTab.svelte")),
	leaders: deferredTab(() => import("./LeadersTab.svelte")),
	laws: deferredTab(() => import("./LawsTab.svelte")),
	techs: deferredTab(() => import("./TechsTab.svelte")),
	orders: deferredTab(() => import("./OrdersTab.svelte")),
	economics: deferredTab(() => import("./YieldsTab.svelte")),
	military: deferredTab(() => import("./MilitaryTab.svelte")),
	cities: deferredTab(() => import("./CitiesTab.svelte")),
	economy: deferredTab(() => import("./EconomyTab.svelte")),
	wonders: deferredTab(() => import("./WondersTab.svelte")),
	families: deferredTab(() => import("./FamiliesTab.svelte")),
	specialists: deferredTab(() => import("./SpecialistsTab.svelte")),
	pins: deferredTab(() => import("./MapPinsTab.svelte")),
	settings: deferredTab(() => import("./SettingsTab.svelte")),
} satisfies Record<LazyTabId, Deferred<unknown>>;

type LazyTab = (typeof LAZY_TABS)[LazyTabId];

// A tab's slot, or undefined for Overview — the one tab that ships with the
// route and so has nothing to wait for.
export function lazyTab(tab: GameTabId): LazyTab | undefined {
	return tab === "overview" ? undefined : LAZY_TABS[tab];
}
