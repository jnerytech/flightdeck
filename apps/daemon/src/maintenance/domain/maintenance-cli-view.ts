/**
 * Issue #3756: what `flightdeckd db status` says, as pure rules over the maintenance status. The command runs on
 * the machine it is typed on, so there is nothing to scrub: every field is a number, a time or a path of this host.
 */
import type { MaintenanceStatus } from "@flightdeck/protocol";

export function statusLines(_status: MaintenanceStatus): string[] {
  return [];
}
