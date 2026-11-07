import type { PendingPermission } from "@flightdeck/protocol";
import { type T, translator } from "../i18n/index.ts";
import type { TrayMenu, TrayStatus } from "../platform/types.ts";
import type { PendingItem } from "./app-store.ts";
import { pendingText } from "./pending-text.ts";

/** Requests listed in the tray submenu; the rest become "e mais N…". */
export const TRAY_MENU_MAX = 10;

/** How long the submenu waits for the list to settle before it is rebuilt. */
export const TRAY_MENU_DELAY_MS = 500;

/** The suite's (and the source dictionary's) language when a caller passes none. */
const PT = translator("pt-BR");

/** What the menu offers for a request: open only, deny and open, or all three. */
function trayActions(item: PendingItem): Array<"approve" | "deny" | "open"> {
  if (item.gate) return ["open"];
  return item.vault || item.risk === "high" ? ["deny", "open"] : ["approve", "deny", "open"];
}

/** The "Precisa de você" submenu for the open requests, oldest first, in `t`'s language. */
export function trayMenu(
  items: PendingItem[],
  t: T = PT,
  /** Whether a host is in simple mode: its requests are told in the plain sentence (issue #88). */
  simpleHost: (hostId: string) => boolean = () => false,
): TrayMenu {
  const more = Math.max(0, items.length - TRAY_MENU_MAX);
  return {
    items: items.slice(0, TRAY_MENU_MAX).map((item) => {
      return {
        key: `${item.hostId}/${item.requestId}`,
        label: `${item.hostName} · ${item.sessionName} · ${
          simpleHost(item.hostId) && item.plain ? item.plain.sentence[t.lang] : pendingText(item, t)
        }`,
        // A gate is answered in the app, and a high-risk request is approved by holding a button.
        // A vault grant is never approved here (#244): this line cannot show the secret and
        // parameters. Deny needs no hold, so both still offer it (#245).
        actions: trayActions(item),
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

/**
 * Tray badge for the whole fleet: total open requests and a per-host breakdown, then how many
 * requests were approved automatically (phase 13) when there were any.
 */
export function trayStatus(hosts: TrayHost[], t: T = PT, autoApproved = 0): TrayStatus {
  const perHost = hosts
    .map((h) => ({
      name: h.name,
      count: h.sessions.reduce((n, s) => n + s.pendingPermissions.length, 0),
    }))
    .filter((h) => h.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const count = perHost.reduce((n, h) => n + h.count, 0);
  const label = t("tray.needsYou", { n: count });
  const auto = autoApproved > 0 ? ` · ${t("tray.autoApproved", { n: autoApproved })}` : "";
  if (count === 0) return { count, label, tooltip: `${t("tray.idle")}${auto}` };
  const breakdown = perHost.map((h) => `${h.name}: ${h.count}`).join(", ");
  return { count, label, tooltip: `${t("tray.waiting", { n: count, hosts: breakdown })}${auto}` };
}
