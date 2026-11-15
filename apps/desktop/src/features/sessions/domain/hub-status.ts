import type { SessionLine } from "@flightdeck/protocol";
import { type Key, type T, translator } from "../../../i18n/index.ts";
import type { HubOrigin, HubRow } from "./hub-row.ts";

const PT = translator("pt-BR");

/** The session's line in the lists: "Pedido: …" and what it is doing, at `nowMs`. */
export function sessionLineText(
  line: SessionLine | null | undefined,
  nowMs: number,
  t: T = PT,
): string {
  if (!line) return "";
  return [
    line.request ? t("line.request", { request: line.request }) : "",
    activity(line, nowMs, t),
  ]
    .filter(Boolean)
    .join(" · ");
}

function activity(line: SessionLine, nowMs: number, t: T): string {
  switch (line.state) {
    case "running":
      return line.tool ? t("line.runningTool", { tool: line.tool }) : t("line.running");
    case "waiting":
      return line.tool ? t("line.waitingTool", { tool: line.tool }) : t("line.waiting");
    case "idle":
      return t("line.idle", { since: idleFor(nowMs - Date.parse(line.since ?? ""), t) }).trim();
    case "ended":
      return "";
  }
}

/** "há 12 min", "há 2 h"; unknown since says just "ociosa". */
function idleFor(ms: number, t: T): string {
  if (Number.isNaN(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t("line.lessThanMinute");
  if (minutes < 60) return t("line.minutes", { n: minutes });
  return t("line.hours", { n: Math.floor(minutes / 60) });
}

/**
 * Issue #1132: what a row says it is doing, under its title: a state word and one detail (the
 * tool it runs or waits on, or how long ago it finished, ended or failed).
 */
export function rowStatus(row: HubRow, nowMs: number, t: T = PT): { word: string; detail: string } {
  // An asleep row says so, as its dot does.
  const word = row.asleep ? t("hub.asleep") : t(`hub.rowWord.${row.state}` as Key);
  const tool = row.summary?.tool ?? null;
  if (row.state === "needs_you") {
    if (row.waiting) return { word, detail: t(`hub.rowDetail.waiting.${row.waiting}` as Key) };
    return { word, detail: tool ? t("hub.rowDetail.waitingTool", { tool }) : "" };
  }
  if (row.state === "running") {
    return { word, detail: tool ? t("hub.rowDetail.runningTool", { tool }) : "" };
  }
  // A background session only knows when it started, which is not when it finished.
  if (row.origin === "background" && row.summary === null) return { word, detail: "" };
  // Finished, ended or failed: how long ago, from the line or the row's last activity.
  const since = row.summary?.since ?? row.lastActivity;
  return { word, detail: idleFor(nowMs - Date.parse(since), t) };
}

/** What every row of a group shares (shown once, in its header); null where the rows differ. */
export function sharedMeta(rows: HubRow[]): {
  hostName: string | null;
  origin: HubOrigin | null;
} {
  const [first] = rows;
  if (!first) return { hostName: null, origin: null };
  return {
    hostName: rows.every((r) => r.hostName === first.hostName) ? first.hostName : null,
    origin: rows.every((r) => r.origin === first.origin) ? first.origin : null,
  };
}
