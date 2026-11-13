import type { T } from "../../i18n/index.ts";
import type { PendingItem } from "../../lib/app-store.ts";
import { inputSummary } from "./tool-input.ts";

/**
 * What a waiting item asks, as one line for a person (issue #175): a workflow gate says which step
 * waits, a request says its tool and what it would do. The row, its name and the tray share it.
 */
export function pendingText(item: PendingItem, t: T): string {
  if (item.gate) return t("needsYou.gateRow", { step: item.gate.stepId });
  if (item.waiting) return t(`hub.rowDetail.waiting.${item.waiting}`);
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
