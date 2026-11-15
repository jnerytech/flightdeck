import type { BoardSyncLogEntry } from "@flightdeck/protocol";
import { formatDateTime } from "@/i18n/format";
import type { T } from "@/i18n/index";

/** One line of a card's sync log, in the app's language. */
export function logLine(entry: BoardSyncLogEntry, t: T): string {
  const at = (iso: string | null) => (iso ? formatDateTime(iso, t.lang) : "");
  const vars = {
    lost: entry.lostValue ?? "",
    lostAt: at(entry.lostAt),
    kept: entry.keptValue ?? "",
    keptAt: at(entry.keptAt),
    detail: entry.detail ?? "",
  };
  switch (entry.kind) {
    case "conflict":
      return entry.winner === "local"
        ? t("boardSyncUi.logConflictLocal", vars)
        : t("boardSyncUi.logConflictExternal", vars);
    case "move_skipped":
      return t("boardSyncUi.logMoveSkipped", vars);
    case "push_failed":
      return t("boardSyncUi.logPushFailed", vars);
    case "push_gave_up":
      return t("boardSyncUi.logPushGaveUp", vars);
    case "title_changed":
      return t("boardSyncUi.logTitleChanged", vars);
    default:
      return entry.kind;
  }
}
