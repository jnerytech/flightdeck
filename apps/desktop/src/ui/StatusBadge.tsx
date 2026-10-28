import type { SessionStatus } from "@flightdeck/protocol";
import { STATUS_LABELS, statusTone } from "../lib/status.ts";

export function StatusBadge({ status }: { status: SessionStatus }) {
  return <span className={`badge badge-${statusTone(status)}`}>{STATUS_LABELS[status]}</span>;
}
