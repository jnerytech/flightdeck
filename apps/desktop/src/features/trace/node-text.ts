/**
 * A trace node's text: its title and its numbers, shared by the trace panel and its replay. Its own
 * file so the replay does not import the panel that renders it (an import cycle, #1589).
 */
import type { TraceNode } from "@flightdeck/protocol";
import { usd } from "@/features/costs/index.ts";
import { formatMs } from "@/features/sessions/index.ts";
import type { useT } from "@/i18n/context";

type T = ReturnType<typeof useT>;

/** What a node says of itself, in one line. */
export function nodeTitle(node: TraceNode, t: T): string {
  if (node.kind === "turn") {
    return t("trace.turn", { n: node.n ?? 0 }) + (node.label ? " · " + node.label : "");
  }
  if (node.kind === "thinking") return t("trace.thinking");
  return node.label ? `${node.name} · ${node.label}` : node.name;
}

/** The numbers of a node: time, cost and tokens, those it has. */
export function nodeNumbers(node: TraceNode, t: T): string {
  const tokens = node.inputTokens + node.outputTokens;
  return [
    node.durationMs === null ? null : formatMs(node.durationMs, t),
    node.costUsd === null ? null : usd(node.costUsd, t.lang),
    tokens === 0 ? null : t("trace.tokens", { input: node.inputTokens, output: node.outputTokens }),
    node.error ? t("trace.failed") : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}
