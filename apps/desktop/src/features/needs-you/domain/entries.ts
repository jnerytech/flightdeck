import { sinceLastLook } from "@/features/sessions/index.ts";
import type { T } from "../../../i18n/index.ts";
import { type AppState, needsYou } from "../../../lib/app-store.ts";
import { budgetAlerts } from "../../costs/index.ts";
import { loopPairKey } from "../../messaging/index.ts";
import { watchAlerts } from "../../watch/index.ts";
import { quietAlerts } from "./quiet.ts";
import type { Entry } from "./same-row.ts";

/** Everything that waits for the person, in the list's order: budget alerts, loops, watches, requests. */
export function entriesOf(state: AppState, t: T, nowMs: number): Entry[] {
  return [
    ...budgetAlerts(state, t).map((a) => ({
      kind: "alert" as const,
      key: `alert/${a.hostId}/${a.label}`,
      label: a.label,
      ...(a.clientId ? { clientId: a.clientId } : {}),
    })),
    ...state.loopAlerts.map((alert) => ({
      kind: "loop" as const,
      key: `loop/${alert.hostId}/${loopPairKey(alert)}`,
      alert,
    })),
    ...watchAlerts(state).map((alert) => ({
      kind: "watch" as const,
      key: `watch/${alert.hostId}/${alert.cardId}`,
      alert,
    })),
    ...needsYou(state, t).map((item) => ({
      kind: "request" as const,
      key: `${item.hostId}/${item.requestId}`,
      item,
    })),
    // Issue #1478: a running session that says nothing waits for the person too, after the requests.
    ...quietAlerts(state, nowMs, t).map((alert) => ({
      kind: "quiet" as const,
      key: `quiet/${alert.key}`,
      alert,
    })),
    // What finished since the person last looked comes after what waits for them.
    ...sinceLastLook(state.finished, state.finishedLook).map((finish) => ({
      kind: "finished" as const,
      key: `finished/${finish.key}`,
      finish,
    })),
  ];
}
