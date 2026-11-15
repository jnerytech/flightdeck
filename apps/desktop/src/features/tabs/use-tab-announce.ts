import { type RefObject, useEffect, useRef, useState } from "react";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { tabTitle } from "./tab-facts.ts";
import type { Tab, Tabs } from "./tabs.ts";

/**
 * What a screen reader is told about a tab row, and where the focus goes after a move: the host the
 * row switched to, a tab moved from the keyboard, and the focus back on the tab that went off with it.
 */
export function useTabAnnounce(props: {
  store: AppStore;
  state: AppState;
  tabs: Tabs;
  shared: Tabs | undefined;
  /** The set a tab belongs to, for what acts on the tab itself. */
  setOf(tab: Tab): Tabs;
  tablist: RefObject<HTMLDivElement | null>;
}): {
  announcement: string;
  /** Moves a tab one place with the keyboard and says where it went. */
  moveByKey(tab: Tab, delta: -1 | 1): void;
  /** Moves a tab one place from its menu; the focus follows when the move button went off. */
  shift(id: string, delta: -1 | 1): void;
} {
  const { store, state, tabs, shared, setOf, tablist } = props;
  const { t } = store.i18n;

  /** What a screen reader is told about the last move or the host the row switched to. */
  const [announcement, setAnnouncement] = useState("");
  // The first area's row says which host it switched to and how many tabs it has, once, by its name.
  // A window that opens on a host says nothing, and neither does a host not loaded yet: the id is
  // not a name a person knows.
  const rowHost = shared ? store.hostTabs.hostId : null;
  const rowName = state.hosts.find((h) => h.id === rowHost)?.name ?? null;
  const hostTabCount = rowHost ? store.hostTabs.tabCount(rowHost) : 0;
  const announcedHost = useRef<string | null | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new tab in the same host does not speak
  useEffect(() => {
    if (announcedHost.current === undefined) {
      announcedHost.current = rowHost;
      return;
    }
    if (!rowHost || rowName === null || announcedHost.current === rowHost) return;
    announcedHost.current = rowHost;
    setAnnouncement(t("tabs.hostCount", { host: rowName, n: hostTabCount }));
  }, [rowHost, rowName]);

  /** The tab a keyboard move just went off with: the focus goes back to it. */
  const focusTab = useRef<string | null>(null);
  /** A move button just went off with the focus on it: the focus goes to the tab instead. */
  const refocusTab = useRef(false);
  useEffect(() => {
    if (focusTab.current) {
      const id = focusTab.current;
      focusTab.current = null;
      tablist.current?.querySelector<HTMLElement>(`[role="tab"][data-tab-id="${id}"]`)?.focus();
    }
    if (!refocusTab.current) return;
    refocusTab.current = false;
    tablist.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  });
  const shift = (id: string, delta: -1 | 1) => {
    tabs.shift(id, delta);
    refocusTab.current = !tabs.canShift(id, delta);
  };
  /** Moves a tab one place with the keyboard and says where it went. */
  const moveByKey = (tab: Tab, delta: -1 | 1) => {
    const own = setOf(tab);
    if (!own.canShift(tab.id, delta)) return;
    own.shift(tab.id, delta);
    focusTab.current = tab.id;
    setAnnouncement(
      t("tabs.moved", {
        title: tabTitle(tab, state, store),
        n: own.tabs.findIndex((other) => other.id === tab.id) + 1,
        total: own.tabs.length,
      }),
    );
  };
  return { announcement, moveByKey, shift };
}
