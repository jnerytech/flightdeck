import type { LucideIcon } from "lucide-react";
import { NAV_ICONS } from "@/components/nav-icons";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import type { TabBadge, TabKind } from "../../lib/tab-badge.ts";
import type { Tab } from "../../lib/tabs.ts";

export const TAB_ICONS: Record<TabKind, LucideIcon> = {
  ...NAV_ICONS,
} as Record<TabKind, LucideIcon>;

/** What a terminal tab says about the ssh destino it was opened from, if it was. */
export function sshOf(_tab: Tab, _store: AppStore): { name: string; tags: string[] } | undefined {
  return undefined;
}

/** The title of a tab: the last step of the path its route shows in the header. */
export function tabTitle(_tab: Tab, _state: AppState, _store: AppStore): string {
  return "";
}

export type TabFactsAt = {
  t: AppStore["i18n"]["t"];
  state: AppState;
  store: AppStore;
  /** The host the tab belongs to; the shared tabs belong to none. */
  host: string | null;
};

/** What a tab of the strip shows and says: its name, kind, badge, server and the words a screen reader gets. */
export function tabFacts(_tab: Tab, _at: TabFactsAt) {
  return {
    label: "",
    kind: "screen" as TabKind,
    Icon: TAB_ICONS.screen,
    badge: null as TabBadge,
    cacheSince: null as string | null,
    ssh: undefined as { name: string; tags: string[] } | undefined,
    prod: undefined as boolean | undefined,
    hostColor: undefined as string | undefined,
    ariaLabel: undefined as string | undefined,
  };
}
