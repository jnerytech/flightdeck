import { inputSummary } from "../features/sessions/index.ts";
import type { T } from "../i18n/index.ts";
import type { PendingItem } from "./app-store.ts";

/**
 * What a waiting item asks, as one line for a person (issue #175): a workflow gate says which step
 * waits, a request says its tool and what it would do. The row, its name and the tray share it.
 */
export function pendingText(item: PendingItem, t: T): string {
  if (item.gate) return t("needsYou.gateRow", { step: item.gate.stepId });
  const summary = inputSummary(item.input);
  return summary ? `${item.toolName}: ${summary}` : item.toolName;
}

/**
 * Who asks, as the row, its details, the search and the tray name it: host · project · card or
 * session. The project keeps two cards of one title in two projects apart (#1545).
 */
export function pendingWhere(item: PendingItem): string {
  return [item.hostName, item.projectName, item.sessionName].filter(Boolean).join(" · ");
}
