import { type FrameRewriter, installHolds } from "./holds.ts";

/**
 * What a print does to one command on the page's sockets (#3982): the host's answer becomes a
 * refusal (`refuse`: its text), the answer's data is replaced (`data`), or the app's request goes to
 * the host as another command (`as`: its answer comes back as it is). The demo's hosts are never
 * left in the state the print shows.
 */
export type WireRule =
  | { command: string; refuse: string }
  | { command: string; data: unknown }
  | { command: string; as: string };

/**
 * A rewriter that applies `rules` to the commands the app asks. It goes into the page as its source
 * (`wireScript`), so it uses nothing outside its own body.
 */
// Not instrumented: its source goes into the page, where an istanbul counter would not exist
// (the istanbul shard of a full run, #1492).
/* istanbul ignore next */
export function wireRewriter(rules: WireRule[]): FrameRewriter {
  const parse = (frame: string): Record<string, unknown> | null => {
    try {
      const value: unknown = JSON.parse(frame);
      return typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const asked = new Map<string, WireRule>();
  return {
    fromApp(frame) {
      const message = parse(frame);
      const rule = rules.find((r) => r.command === message?.type);
      if (!message || !rule || typeof message.id !== "string") return frame;
      asked.set(message.id, rule);
      return "as" in rule ? JSON.stringify({ ...message, type: rule.as }) : frame;
    },
    fromHost(frame) {
      const message = parse(frame);
      const id = message?.id;
      const rule = typeof id === "string" ? asked.get(id) : undefined;
      if (message?.type !== "ack" || typeof id !== "string" || !rule) return frame;
      asked.delete(id);
      if (message.ok !== true) return frame;
      if ("refuse" in rule) {
        const refused: Record<string, unknown> = {
          ...message,
          ok: false,
          error: { code: "unavailable", message: rule.refuse },
        };
        delete refused.data;
        return JSON.stringify(refused);
      }
      return "data" in rule ? JSON.stringify({ ...message, data: rule.data }) : frame;
    },
  };
}

/** The init script a print adds: the page's WebSocket wrapped with `wireRewriter(rules)`. */
export function wireScript(rules: WireRule[]): string {
  return `(${installHolds.toString()})(window, () => (${wireRewriter.toString()})(${JSON.stringify(rules)}));`;
}
