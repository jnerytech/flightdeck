import { type FrameRewriter, installHolds } from "./holds.ts";

/**
 * What a print does to one command on the page's sockets (#3982): the host's answer becomes a
 * refusal (`refuse`: its text), the answer's data is replaced (`data`), or the app's request goes to
 * the host as another command (`as`: its answer comes back as it is, or with the `data` the rule
 * also gives). #4154: `after` is the data of every answer after the first; `hold` leaves the answer
 * unheard, so the panel stays loading; `reply` answers in the page and never sends the command (a
 * change the host would really make); `reject` answers in the page with a refusal and `stall` leaves
 * the command unanswered, both without sending it (an answer to a request the host would really
 * take, #4203); `without` takes entries out of an array of the answer (a feature the host announces). The demo's hosts are never left in the state the print shows.
 */
export type WireRule =
  | { command: string; refuse: string }
  | { command: string; data: unknown; after?: unknown }
  | { command: string; as: string; data?: unknown }
  | { command: string; reply: unknown }
  | { command: string; hold: true }
  | { command: string; reject: string }
  | { command: string; stall: true }
  | { command: string; without: Record<string, string[]> };

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
  /** The rules that already gave an answer: a later one takes `after`. */
  const answered = new Set<WireRule>();
  const ruleOf = (frame: string): WireRule | undefined => {
    const message = parse(frame);
    return message?.type === "ack" && typeof message.id === "string"
      ? asked.get(message.id)
      : undefined;
  };
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
      if ("without" in rule) {
        const data: Record<string, unknown> =
          typeof message.data === "object" && message.data !== null
            ? { ...(message.data as Record<string, unknown>) }
            : {};
        for (const [field, gone] of Object.entries(rule.without)) {
          const list = data[field];
          if (Array.isArray(list)) data[field] = list.filter((item) => !gone.includes(item));
        }
        return JSON.stringify({ ...message, data });
      }
      if (!("data" in rule)) return frame;
      const later = answered.has(rule) && "after" in rule;
      answered.add(rule);
      return JSON.stringify({ ...message, data: later ? rule.after : rule.data });
    },
    drops(frame) {
      const rule = ruleOf(frame);
      return rule !== undefined && "hold" in rule;
    },
    answer(frame) {
      const message = parse(frame);
      const rule = rules.find((r) => r.command === message?.type);
      if (!message || !rule || typeof message.id !== "string") return undefined;
      if ("reject" in rule) {
        const error = { code: "unavailable", message: rule.reject };
        return JSON.stringify({ type: "ack", id: message.id, ok: false, error });
      }
      if (!("reply" in rule)) return undefined;
      return JSON.stringify({ type: "ack", id: message.id, ok: true, data: rule.reply });
    },
    swallows(frame) {
      const message = parse(frame);
      return rules.some((r) => "stall" in r && r.command === message?.type);
    },
  };
}

/** The init script a print adds: the page's WebSocket wrapped with `wireRewriter(rules)`. */
export function wireScript(rules: WireRule[]): string {
  return `(${installHolds.toString()})(window, () => (${wireRewriter.toString()})(${JSON.stringify(rules)}));`;
}
