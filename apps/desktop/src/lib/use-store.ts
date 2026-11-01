import { useSyncExternalStore } from "react";
import type { AppState, AppStore } from "./app-store.ts";
import type { SessionState } from "./session-state.ts";

/** The app's state, for every screen but a session's own conversation. */
export function useStoreState(store: AppStore): AppState {
  return useSyncExternalStore(store.subscribe, store.getState);
}

const NO_SESSION: SessionState = {
  lastSeq: 0,
  items: [],
  streaming: "",
  toolResults: {},
  pending: [],
};

/** One session's conversation: it changes with that session's events, and with no other. */
export function useSessionState(store: AppStore, key: string): SessionState {
  return useSyncExternalStore(store.subscribe, () => store.getState().sessions[key] ?? NO_SESSION);
}
