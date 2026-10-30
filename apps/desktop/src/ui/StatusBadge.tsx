import type { SessionStatus } from "@flightdeck/protocol";
import { StatusText } from "@/components/status/status-text";
import { useT } from "@/i18n/context";
import type { Key } from "../i18n/index.ts";
import { statusTone } from "../lib/status.ts";

/** A session's status: its dot and its word. */
export function StatusBadge({ status }: { status: SessionStatus }) {
  const t = useT();
  return <StatusText tone={statusTone(status)}>{t(`status.${status}` as Key)}</StatusText>;
}
