import type { T } from "@/i18n/index";
import type { ConnectionStatus } from "@/lib/host-connection";
import { type HostTone, hostStatusView } from "@/lib/host-status";
import { cn } from "@/lib/utils";

// Whole class names, so Tailwind finds them; colors come from the state tokens.
const TONE_CLASS: Record<HostTone, string> = {
  online: "text-status-idle",
  reconnecting: "text-status-needs-you",
  offline: "text-status-idle",
  refused: "text-status-error",
  incompatible: "text-status-risk",
};

/** A host's connection as colored text: offline and reconnecting never look alike. */
export function HostStatusBadge(props: { status: ConnectionStatus; t: T }) {
  const { label, tone } = hostStatusView(props.status, props.t);
  return <span className={cn("text-xs", TONE_CLASS[tone])}>{label}</span>;
}
