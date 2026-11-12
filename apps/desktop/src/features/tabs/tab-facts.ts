import {
  BookOpen,
  Bot,
  type LucideIcon,
  MessageSquare,
  SquareKanban,
  SquareTerminal,
} from "lucide-react";
import { hostColorVar } from "@/features/hosts/index.ts";
import { breadcrumb, NAV_ICONS } from "@/features/shell/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { isProd } from "../ssh/index.ts";
import { type TabKind, tabBadge, tabIdleSince, tabKind } from "./tab-badge.ts";
import type { Tab } from "./tabs.ts";

export const TAB_ICONS: Record<TabKind, LucideIcon> = {
  session: MessageSquare,
  card: SquareKanban,
  terminal: SquareTerminal,
  reader: BookOpen,
  agent: Bot,
  screen: NAV_ICONS.sessions,
  ...NAV_ICONS,
};

/** What a terminal tab says about the ssh destino it was opened from, if it was. */
function sshOf(tab: Tab, store: AppStore) {
  const route = tab.router.current;
  return route.name === "terminal"
    ? store.ssh.terminals.get(`${route.host}/${route.terminalId}`)
    : undefined;
}

/**
 * The title of a tab: the last step of the path its route shows in the header. A host's Overview and
 * History end in the host's name, which the row already says (it belongs to that host): they show
 * their section instead (issue #644).
 */
export function tabTitle(tab: Tab, state: AppState, store: AppStore): string {
  const ssh = sshOf(tab, store);
  if (ssh) return store.i18n.t("terminalUi.sshBadge", { name: ssh.name });
  const route = tab.router.current;
  if (route.name === "host") return store.i18n.t("hostHome.overview");
  if (route.name === "history") return store.i18n.t("sidebar.history");
  return breadcrumb(route, state, store.i18n.t).at(-1)?.label ?? "";
}

type TabFactsAt = {
  t: AppStore["i18n"]["t"];
  state: AppState;
  store: AppStore;
  /** The host the tab belongs to; the shared tabs belong to none. */
  host: string | null;
};

/** What a tab of the strip shows and says: its name, kind, badge, server and the words a screen reader gets. */
export function tabFacts(tab: Tab, at: TabFactsAt) {
  const { t, state, store, host } = at;
  const label = tabTitle(tab, state, store);
  const kind = tabKind(tab.router.current);
  const badge = tabBadge(tab.router.current, state);
  const pinnedLabel = badge ? [label, t(`tabs.badge.${badge}`)].join(", ") : label;
  const ssh = sshOf(tab, store);
  const hostName = host ? (state.hosts.find((h) => h.id === host)?.name ?? host) : undefined;
  // A pinned tab shows no title, and a host's tab no longer carries its host's name in it: the
  // name is set here, with the badge's words.
  const pinnedName = tab.pinned ? pinnedLabel : undefined;
  return {
    label,
    kind,
    Icon: TAB_ICONS[kind],
    badge,
    cacheSince: tabIdleSince(tab.router.current, state),
    ssh,
    // A production server is easy to mistake for another: its tab gets a red border.
    prod: ssh ? isProd(ssh.tags) : undefined,
    // The host's tabs carry its color.
    hostColor: host ? hostColorVar(host) : undefined,
    ariaLabel: hostName ? t("tabs.named", { title: pinnedLabel, host: hostName }) : pinnedName,
  };
}
