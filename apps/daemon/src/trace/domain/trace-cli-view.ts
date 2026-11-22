/**
 * Issue #3701: what `flightdeckd trace get` prints, as pure rules over the daemon's answer. The text is a
 * header (what cost most and took longest) and the tree, one line for each node: the kind, the name or the
 * turn's number, the prompt of a turn or a subagent, how long it took, what it cost and whether it failed.
 * The text of a tool's input and result is left out here as it is in the app's list; `--json` has it all.
 */
import type { SessionTrace, TraceNode } from "@flightdeck/protocol";

const LABEL_WIDTH = 60;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const dollars = (usd: number) => `$${usd.toFixed(2)}`;

const clip = (text: string) =>
  text.length > LABEL_WIDTH ? `${text.slice(0, LABEL_WIDTH - 1)}…` : text;

/** `turn 2`, `tool Bash`, `subagent Explore`; a node whose name is its kind (a thought) is that word alone. */
function title(node: TraceNode): string {
  if (node.kind === "turn") return `turn ${node.n ?? ""}`.trim();
  return node.name === node.kind ? node.kind : `${node.kind} ${node.name}`;
}

function nodeLine(node: TraceNode, depth: number): string {
  const label = node.label ? ` "${clip(node.label)}"` : "";
  const figures = [
    ...(node.durationMs === null ? [] : [seconds(node.durationMs)]),
    ...(node.costUsd === null ? [] : [dollars(node.costUsd)]),
    ...(node.error ? ["error"] : []),
  ];
  const tail = figures.length === 0 ? "" : ` ${figures.join(", ")}`;
  return `${"  ".repeat(depth)}${title(node)}${label}${tail}`;
}

function treeLines(nodes: TraceNode[], depth: number): string[] {
  return nodes.flatMap((node) => [nodeLine(node, depth), ...treeLines(node.children, depth + 1)]);
}

/** The totals of the session, what stood out, then the turns with what they ran. */
export function traceLines(trace: SessionTrace): string[] {
  if (trace.turns.length === 0) return [`${trace.claudeSessionId}: no turn yet`];
  const totals = [
    ...(trace.costUsd === null ? [] : [dollars(trace.costUsd)]),
    ...(trace.durationMs === null ? [] : [seconds(trace.durationMs)]),
  ];
  const totalsSuffix = totals.length === 0 ? "" : `: ${totals.join(", ")}`;
  return [
    `${trace.claudeSessionId}${totalsSuffix}`,
    ...(trace.costliest === null ? [] : [`costliest: ${trace.costliest}`]),
    ...(trace.slowest === null ? [] : [`slowest: ${trace.slowest}`]),
    ...treeLines(trace.turns, 0),
  ];
}

/** Why a script that reads the file may find less than it expects: the fields the daemon replaced. */
export const redactedNote = (count: number): string =>
  `${count} ${count === 1 ? "field" : "fields"} of the content held a secret and ${count === 1 ? "was" : "were"} replaced`;
