import type { PendingPermission } from "@flightdeck/protocol";
import type { TrayMenu, TrayStatus } from "../platform/types.ts";
import type { PendingItem } from "./app-store.ts";
import { inputSummary } from "./tool-input.ts";

/** Requests listed in the tray submenu; the rest become "e mais N…". */
export const TRAY_MENU_MAX = 10;

/** How long the submenu waits for the list to settle before it is rebuilt. */
export const TRAY_MENU_DELAY_MS = 500;

/** The "Precisa de você" submenu for the open requests, oldest first. */
export function trayMenu(items: PendingItem[]): TrayMenu {
  return {
    items: items.slice(0, TRAY_MENU_MAX).map((item) => {
      const summary = inputSummary(item.input);
      const tool = summary ? `${item.toolName}: ${summary}` : item.toolName;
      return {
        key: `${item.hostId}/${item.requestId}`,
        label: `${item.hostName} · ${item.sessionName} · ${tool}`,
        actions: item.gate ? ["open"] : ["approve", "deny", "open"],
      };
    }),
    more: Math.max(0, items.length - TRAY_MENU_MAX),
  };
}

export interface TrayHost {
  name: string;
  sessions: { pendingPermissions: PendingPermission[] }[];
}

/** Tray badge for the whole fleet: total open requests and a per-host breakdown. */
export function trayStatus(hosts: TrayHost[]): TrayStatus {
  const perHost = hosts
    .map((h) => ({
      name: h.name,
      count: h.sessions.reduce((n, s) => n + s.pendingPermissions.length, 0),
    }))
    .filter((h) => h.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const count = perHost.reduce((n, h) => n + h.count, 0);
  if (count === 0) return { count, tooltip: "Flightdeck: nada esperando você" };
  const noun = count === 1 ? "pedido" : "pedidos";
  const breakdown = perHost.map((h) => `${h.name}: ${h.count}`).join(", ");
  return { count, tooltip: `Flightdeck: ${count} ${noun} esperando você (${breakdown})` };
}
