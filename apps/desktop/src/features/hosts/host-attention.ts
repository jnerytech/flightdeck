import type { DepsResult } from "@flightdeck/protocol";
import type { HostView } from "../../lib/app-state.ts";
import { requiredMissing } from "../../lib/deps-summary.ts";

/** A machine the person should look at: not connected, a required dependency missing, or its key forwarded. */
export function hostNeedsAttention(
  host: Pick<HostView, "status" | "hostInfo">,
  deps: DepsResult | undefined,
): boolean {
  return (
    host.status === "offline" ||
    host.status === "unauthorized" ||
    host.status === "incompatible" ||
    requiredMissing(deps) ||
    host.hostInfo?.apiKeySanitized === false
  );
}
