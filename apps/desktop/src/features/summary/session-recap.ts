import type { SessionRecap } from "@flightdeck/protocol";
import type { HostView } from "../../lib/app-state.ts";
import type { AppKernel } from "../../lib/kernel.ts";
import { hasFeature } from "../../lib/version.ts";

/** Phase 30: the summary of a session of a host; null when the host cannot give one. */
export async function sessionRecap(
  kernel: Pick<AppKernel<{ hosts: HostView[] }>, "state" | "dispatch">,
  hostId: string,
  claudeSessionId: string,
  extra: { question?: string } = {},
): Promise<SessionRecap | null> {
  const host = kernel.state().hosts.find((h) => h.id === hostId);
  if (!hasFeature(host?.hostInfo?.features, "summary", false)) return null;
  try {
    return await kernel.dispatch(hostId, "session.summary", { claudeSessionId, ...extra });
  } catch {
    return null;
  }
}
