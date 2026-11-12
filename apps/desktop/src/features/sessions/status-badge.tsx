import type { SessionStatus } from "@flightdeck/protocol";
import { useT } from "@/i18n/context";
import { statusTone } from "@/shared/lib/index.ts";
import { StatusText } from "@/shared/status/index.ts";
import type { Key } from "../../i18n/index.ts";

/** A session's status: its dot and its word. */
export function StatusBadge({ status }: Readonly<{ status: SessionStatus }>) {
  const t = useT();
  return <StatusText tone={statusTone(status)}>{t(`status.${status}` as Key)}</StatusText>;
}
