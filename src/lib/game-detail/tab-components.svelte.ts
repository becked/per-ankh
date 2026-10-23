// The tab components a game's analysis loads on demand. Imported statically
// they all land in the /games/[id] route chunk, so every visitor downloaded
// all fourteen tabs to read the one or two they open (#178) — each entry below
// is its own chunk instead, fetched when its tab is first opened.
//
// Overview is deliberately absent and stays a static import in GameTab: it is
// the tab both views open on and the only one SSR renders, so deferring it
// would replace a server-rendered pane with a loading state and charge a round
// trip before the page said anything.
import type { GameTabId } from "./game-tabs.svelte";

// Every tab but Overview.
type LazyTabId = Exclude<GameTabId, "overview">;

type Deferred<T> = {
	/** The component, once its chunk has arrived. */
	readonly component: T | undefined;
	/** True once the chunk has failed to arrive. */
	readonly failed: boolean;
	/** Fetch the chunk, at most once per page load. */
	start: () => void;
};

// One tab's chunk and what it resolved to. Each slot keeps its own component
// type, inferred from its own `import()`: one shared component type across the
// thirteen would accept any props at all, and a prop a tab never received is
// exactly the defect that would hide behind it.
//
// The state is module-level, so the two views that render tabs — the analyst
// view's panes and the map view's lightboxes — share one copy of each: a tab
// opened a second time renders with no loading state at all.
//
// A failed fetch latches. The cause it exists for is a deploy, where the
// chunk a tab asks for is a file the new build no longer serves, and a retry
// against the same stale manifest would fail the same way — so GameTab offers
// a reload, which lands on the new build.
function deferred<T>(load: () => Promise<{ default: T }>): Deferred<T> {
	let component = $state<T>();
	let failed = $state(false);
	let started = false;

	return {
		get component(): T | undefined {
			return component;
		},
		get failed(): boolean {
			return failed;
		},
		start(): void {
			if (started) return;
			started = true;
			load().then(
				(module) => (component = module.default),
				() => (failed = true),
			);
		},
	};
}

// Keyed by tab id, which is not the component's name for every tab — the
// Yields tab's id is `economics` (see GameTabId). `satisfies` is what makes a
// new tab id a type error here rather than a tab that renders nothing.
export const LAZY_TABS = {
	events: deferred(() => import("./EventsTab.svelte")),
	leaders: deferred(() => import("./LeadersTab.svelte")),
	laws: deferred(() => import("./LawsTab.svelte")),
	techs: deferred(() => import("./TechsTab.svelte")),
	orders: deferred(() => import("./OrdersTab.svelte")),
	economics: deferred(() => import("./YieldsTab.svelte")),
	military: deferred(() => import("./MilitaryTab.svelte")),
	cities: deferred(() => import("./CitiesTab.svelte")),
	economy: deferred(() => import("./EconomyTab.svelte")),
	wonders: deferred(() => import("./WondersTab.svelte")),
	families: deferred(() => import("./FamiliesTab.svelte")),
	specialists: deferred(() => import("./SpecialistsTab.svelte")),
	settings: deferred(() => import("./SettingsTab.svelte")),
} satisfies Record<LazyTabId, Deferred<unknown>>;

type LazyTab = (typeof LAZY_TABS)[LazyTabId];

// A tab's slot, or undefined for Overview — the one tab that ships with the
// route and so has nothing to wait for.
export function lazyTab(tab: GameTabId): LazyTab | undefined {
	return tab === "overview" ? undefined : LAZY_TABS[tab];
}
