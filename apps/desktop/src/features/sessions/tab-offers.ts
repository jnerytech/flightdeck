import type { HostView } from "../../lib/app-store.ts";

/** What the tabs of a session's page offer on a host. */
export function sessionTabOffers(
  _host: HostView | undefined,
  _opencode: boolean,
  _sessionId: string,
  _embedded: boolean,
): {
  terminal?: { session: string };
  enabled: boolean;
  messagingId: string | null;
  telemetry: boolean;
  trace: boolean;
  files: boolean;
} {
  return {
    enabled: true,
    messagingId: "" as string | null,
    telemetry: true,
    trace: true,
    files: true,
  };
}
