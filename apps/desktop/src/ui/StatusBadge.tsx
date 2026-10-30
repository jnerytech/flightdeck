import type { SessionStatus } from "@flightdeck/protocol";
import { StatusText } from "@/components/status/status-text";
import { STATUS_LABELS, statusTone } from "../lib/status.ts";

/** A session's status: its dot and its word. */
export function StatusBadge({ status }: { status: SessionStatus }) {
  return <StatusText tone={statusTone(status)}>{STATUS_LABELS[status]}</StatusText>;
}
