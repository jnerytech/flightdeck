import { useRef, useSyncExternalStore } from "react";
import type { AppState, AppStore } from "./app-store.ts";
import type { SessionState } from "./session-state.ts";

/** Whether two states differ in nothing but the conversations (`sessions`). */
function sameButSessions(a: AppState, b: AppState): boolean {
  return (Object.keys(b) as Array<keyof AppState>).every(
    (key) => key === "sessions" || a[key] === b[key],
  );
}

/**
 * The app's state, for every screen but a conversation: a session's events (a token a few times a
 * second while it streams) change only `sessions`, and what does not read it keeps the state it
 * had, so it does not render. A conversation reads its own with `useSessionState`.
 */
export function useStoreState(store: AppStore): AppState {
  const held = useRef<AppState | null>(null);
  return useSyncExternalStore(store.subscribe, () => {
    const next = store.getState();
    if (held.current && sameButSessions(held.current, next)) return held.current;
    held.current = next;
    return next;
  });
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

/**
 * Some parts of the app's state, for a screen that reads only those: it renders when one of them
 * is replaced and not for any other change. `keys` must be the same list on every render (a
 * constant at module level).
 */
export function useStoreSlice<K extends keyof AppState>(
  store: AppStore,
  _keys: readonly K[],
): Pick<AppState, K> {
  return store.getState();
}
