import { writable } from "svelte/store";

/**
 * Store for triggering data refreshes across the app.
 * When import completes or database changes, call trigger() to notify
 * all subscribers to re-fetch their data.
 */
function createRefreshStore() {
  const { subscribe, set } = writable(0);

  return {
    subscribe,
    trigger: () => set(Date.now()),
  };
}

export const refreshData = createRefreshStore();
