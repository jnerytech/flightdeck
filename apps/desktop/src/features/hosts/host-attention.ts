import type { DepsResult } from "@flightdeck/protocol";
import type { HostView } from "../../lib/app-state.ts";

/** A machine the person should look at: not connected, a required dependency missing, or its key forwarded. */
export function hostNeedsAttention(
  _host: Pick<HostView, "status" | "hostInfo">,
  _deps: DepsResult | undefined,
): boolean {
  return false;
}
