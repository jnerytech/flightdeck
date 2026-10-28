import type { PendingPermission } from "@flightdeck/protocol";
import type { TrayStatus } from "../platform/types.ts";

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
