import type { HostView } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";

/**
 * What the tabs of a session's page offer: the host's features, and Phase 39: these tabs read Claude
 * Code's transcript, so OpenCode sessions stay out of them and out of messaging. Issue #107: a shell
 * in the session's folder, where the host opens one for a session.
 */
export function sessionTabOffers(
  host: HostView | undefined,
  opencode: boolean,
  sessionId: string,
  embedded: boolean,
) {
  const claudeHas = (feature: string) =>
    !opencode && hasFeature(host?.hostInfo?.features, feature, false);
  return {
    ...(embedded && hasFeature(host?.hostInfo?.features, "terminal.session", false)
      ? { terminal: { session: sessionId } }
      : {}),
    enabled: claudeHas("review"),
    messagingId: claudeHas("messaging") ? sessionId : null,
    telemetry: claudeHas("telemetry"),
    trace: claudeHas("trace"),
    files: claudeHas("file.list"),
  };
}
