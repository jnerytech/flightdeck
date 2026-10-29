import type { SessionStatus } from "@flightdeck/protocol";
import { StateBadge } from "@/components/status/state-badge";
import { STATUS_LABELS, statusTone } from "../lib/status.ts";

export function StatusBadge({ status }: { status: SessionStatus }) {
  return <StateBadge tone={statusTone(status)}>{STATUS_LABELS[status]}</StateBadge>;
}
