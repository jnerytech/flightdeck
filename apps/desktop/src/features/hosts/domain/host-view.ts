import type { HelloResult, HostInfoResult } from "@flightdeck/protocol";
import type { SidebarSession } from "../../sessions/index.ts";
import type { ConnectionStatus } from "../host-connection.ts";
import type { HostConfig } from "../hosts.ts";
import type { RetryState } from "./host-offline.ts";

export interface HostView extends HostConfig {
  status: ConnectionStatus;
  info: HelloResult | null;
  /** From `host.info`, fetched on each connect; `null` until then or on daemons without it. */
  hostInfo: HostInfoResult | null;
  /** When `hostInfo` arrived (epoch ms), so its uptime can be aged. */
  infoAt: number;
  /** The last failed try and the next one, while the host is offline. */
  retry: RetryState | null;
  /** Why the daemon refused this app's protocol, while `status` is `incompatible`. */
  incompatibility: string | null;
  /** Phase 9: an update of the daemon asked from the app, until it comes back on `target`. */
  daemonUpdate: { target: string; failed: string | null } | null;
  /** The daemon's update check asked for from the app: running, or why it did not run. */
  updateCheck: { busy: boolean; failed: string | null } | null;
  sessions: SidebarSession[];
}
