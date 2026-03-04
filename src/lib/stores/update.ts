import { writable } from "svelte/store";
import type { Update } from "@tauri-apps/plugin-updater";

export const pendingUpdate = writable<Update | null>(null);
