import type { PendingPermission } from "@flightdeck/protocol";
import { type T, translator } from "../../../i18n/index.ts";
import type { TrayMenu, TrayStatus } from "../../../platform/types.ts";
import { type PendingItem, pendingText, pendingWhere } from "../../needs-you/index.ts";

/** Requests listed in the tray submenu; the rest become "e mais N…". */
const TRAY_MENU_MAX = 10;

/** Windows shows 127 characters of a tooltip (a 128-character buffer with its terminator). */
const TOOLTIP_MAX = 127;

/** How long the submenu waits for the list to settle before it is rebuilt. */
export const TRAY_MENU_DELAY_MS = 500;

/** The suite's (and the source dictionary's) language when a caller passes none. */
const PT = translator("pt-BR");

/** What the menu offers for a request: open only, deny and open, or all three. */
function trayActions(item: PendingItem): Array<"approve" | "deny" | "open"> {
  if (item.gate || item.waiting) return ["open"];
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
        label: `${pendingWhere(item)} · ${
          simpleHost(item.hostId) && item.plain ? item.plain.sentence[t.lang] : pendingText(item, t)
        }`,
        // A gate is answered in the app, a wait in the terminal, and a high-risk request is approved by holding a button.
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

/**
 * The tooltip cut to what Windows shows (#4121): the hosts with the most requests stay and the rest
 * are counted ("and 3 more hosts"), the request total is always the full one. Hosts go first; only
 * when even one host does not fit with the automatic approvals are those dropped, and a name too long
 * for the limit on its own is cut with an ellipsis.
 */
function fitTooltip(
  perHost: { name: string; count: number }[],
  told: (hosts: string) => string,
  auto: string,
  t: T,
): string {
  const text = (shown: number, withAuto: boolean): string => {
    const names = perHost.slice(0, shown).map((h) => `${h.name}: ${h.count}`);
    if (shown < perHost.length) names.push(t("tray.moreHosts", { n: perHost.length - shown }));
    return `${told(names.join(", "))}${withAuto ? auto : ""}`;
  };
  for (const withAuto of [true, false]) {
    for (let shown = perHost.length; shown > 0; shown--) {
      const fits = text(shown, withAuto);
      if (fits.length <= TOOLTIP_MAX) return fits;
    }
  }
  // Windows counts UTF-16 units, so the cut may fall inside a pair: drop its first half.
  const cut = text(1, false).slice(0, TOOLTIP_MAX - 1);
  const last = cut.charCodeAt(cut.length - 1);
  return `${last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut}…`;
}

export interface TrayHost {
  name: string;
  /** The host is in simple mode: its requests are told as tasks waiting for an answer (issue #88). */
  simple?: boolean;
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
  // Plain words only when every host that waits is in simple mode: a mixed fleet keeps the usual one.
  const plainly = hosts
    .filter((h) => perHost.some((p) => p.name === h.name))
    .every((h) => h.simple);
  const key = plainly ? "tray.plainWaiting" : "tray.waiting";
  const told = (hosts: string) => t(key, { n: count, hosts });
  return { count, label, tooltip: fitTooltip(perHost, told, auto, t) };
}
