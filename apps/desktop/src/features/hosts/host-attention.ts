import type { DepsResult, HostInfoResult } from "@flightdeck/protocol";
import { requiredMissing } from "../../lib/deps-summary.ts";
import type { ConnectionStatus } from "../../lib/host-connection.ts";

/** A machine the person should look at: not connected, a required dependency missing, or its key forwarded. */
export function hostNeedsAttention(
  host: { status: ConnectionStatus; hostInfo: HostInfoResult | null },
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
