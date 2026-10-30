import type { PendingPermission } from "@flightdeck/protocol";
import { type T, translator } from "../i18n/index.ts";
import type { TrayMenu, TrayStatus } from "../platform/types.ts";
import type { PendingItem } from "./app-store.ts";
import { inputSummary } from "./tool-input.ts";

/** Requests listed in the tray submenu; the rest become "e mais N…". */
export const TRAY_MENU_MAX = 10;

/** How long the submenu waits for the list to settle before it is rebuilt. */
export const TRAY_MENU_DELAY_MS = 500;

/** The suite's (and the source dictionary's) language when a caller passes none. */
const PT = translator("pt-BR");

/** The "Precisa de você" submenu for the open requests, oldest first, in `t`'s language. */
export function trayMenu(items: PendingItem[], t: T = PT): TrayMenu {
  const more = Math.max(0, items.length - TRAY_MENU_MAX);
  return {
    items: items.slice(0, TRAY_MENU_MAX).map((item) => {
      const summary = inputSummary(item.input);
      const tool = summary ? `${item.toolName}: ${summary}` : item.toolName;
      return {
        key: `${item.hostId}/${item.requestId}`,
        label: `${item.hostName} · ${item.sessionName} · ${tool}`,
        // A gate is answered in the app, and a high-risk request is approved by holding a button.
        actions: item.gate || item.risk === "high" ? ["open"] : ["approve", "deny", "open"],
      };
    }),
    more,
    // The Rust shell shows these as they come (phase 10: from the dictionary).
    labels: {
      approve: t("tray.approve"),
      deny: t("tray.deny"),
      open: t("tray.open"),
      more: t("tray.more", { n: more }),
      empty: t("tray.empty"),
      show: t("tray.show"),
      quit: t("tray.quit"),
    },
  };
}

export interface TrayHost {
  name: string;
  sessions: { pendingPermissions: PendingPermission[] }[];
}

/** Tray badge for the whole fleet: total open requests and a per-host breakdown. */
export function trayStatus(hosts: TrayHost[], t: T = PT): TrayStatus {
  const perHost = hosts
    .map((h) => ({
      name: h.name,
      count: h.sessions.reduce((n, s) => n + s.pendingPermissions.length, 0),
    }))
    .filter((h) => h.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const count = perHost.reduce((n, h) => n + h.count, 0);
  const label = t("tray.needsYou", { n: count });
  if (count === 0) return { count, label, tooltip: t("tray.idle") };
  const breakdown = perHost.map((h) => `${h.name}: ${h.count}`).join(", ");
  return { count, label, tooltip: t("tray.waiting", { n: count, hosts: breakdown }) };
}
