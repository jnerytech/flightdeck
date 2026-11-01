import type { TraceNode } from "@flightdeck/protocol";

/** Every node in the order the session ran: a node, then what is under it. */
export function flatten(nodes: TraceNode[]): TraceNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/** The tools called anywhere in the trace, once each, in order. */
export function toolNames(nodes: TraceNode[]): string[] {
  return [
    ...new Set(
      flatten(nodes)
        .filter((n) => n.kind === "tool")
        .map((n) => n.name),
    ),
  ].sort();
}

/**
 * The trace seen through a tool filter: its calls, and the turns and subagents they sit in.
 * Nothing filtered (an empty name) is the trace itself.
 */
export function onlyTool(nodes: TraceNode[], tool: string): TraceNode[] {
  if (tool === "") return nodes;
  return nodes.flatMap((node) => {
    if (node.kind === "tool") return node.name === tool ? [node] : [];
    if (node.kind === "thinking") return [];
    const children = onlyTool(node.children, tool);
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

/** The longest call under a turn: the bars of the tree are drawn against it. */
export function longest(nodes: TraceNode[]): number {
  return Math.max(0, ...flatten(nodes).map((n) => (n.kind === "turn" ? 0 : (n.durationMs ?? 0))));
}

/** The number of the turn a node belongs to, for the checkpoint of that turn. */
export function turnOf(turns: TraceNode[], id: string): number | null {
  return turns.find((turn) => flatten([turn]).some((n) => n.id === id))?.n ?? null;
}
