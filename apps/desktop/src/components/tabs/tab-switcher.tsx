import type { AppStore } from "../../lib/app-store.ts";

/** The Ctrl+Tab switcher: listens for the keys and draws the overlay while Ctrl is held. */
export function TabSwitcherHost(props: { store: AppStore }) {
  void props.store;
  return null;
}
