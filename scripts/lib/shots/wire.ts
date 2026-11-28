import { type FrameRewriter, installHolds } from "./holds.ts";

/**
 * What a print does to one command on the page's sockets (#3982): the host's answer becomes a
 * refusal (`refuse`: its text), the answer's data is replaced (`data`), or the app's request goes to
 * the host as another command (`as`: its answer comes back as it is, or with the `data` the rule
 * also gives, and with `afterRefuse` every answer after the first is refused with that text, #4252).
 * #4154: `after` is the data of every answer after the first; `hold` leaves the answer
 * unheard, so the panel stays loading; `reply` answers in the page and never sends the command (a
 * change the host would really make; a `"{in 30s}"` in it is the time 30 s from the answer, #4229, and a `"{in -90s}"` the time 90 s before it, #4287); `reject` answers in the page with a refusal and `stall` leaves
 * the command unanswered, both without sending it (an answer to a request the host would really
 * take, #4203); `without` takes entries out of an array of the answer (a feature the host announces; `"*"` takes every entry, #4388) and `with` adds them (one it does not). The demo's hosts are never left in the state the print shows.
 * #4194: every rule applies on the socket of every host, unless it names a `port`: then only the host that listens there is touched, so the others answer (a page read by some hosts and refused by one).
 */
export type WireRule = (
  | { command: string; refuse: string }
  | { command: string; data: unknown; after?: unknown }
  | { command: string; as: string; data?: unknown; afterRefuse?: string }
  | { command: string; reply: unknown }
  | { command: string; hold: true }
  | { command: string; reject: string }
  | { command: string; stall: true }
  | { command: string; without: Record<string, string[]> }
  | { command: string; with: Record<string, string[]> }
  | { command: string; set: Record<string, unknown> }
) & { port?: number };

/**
 * A rewriter that applies `rules` to the commands the app asks. It goes into the page as its source
 * (`wireScript`), so it uses nothing outside its own body.
 */
// Not instrumented: its source goes into the page, where an istanbul counter would not exist
// (the istanbul shard of a full run, #1492).
/* istanbul ignore next */
export function wireRewriter(allRules: WireRule[], url = ""): FrameRewriter {
  // #4194: a rule with a `port` is for the host that listens there; the others apply to every host.
  const port = (() => {
    try {
      return Number(new URL(url).port);
    } catch {
      return Number.NaN;
    }
  })();
  const rules = allRules.filter((rule) => rule.port === undefined || rule.port === port);
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
      const refusal = (text: string): string => {
        const refused: Record<string, unknown> = {
          ...message,
          ok: false,
          error: { code: "unavailable", message: text },
        };
        delete refused.data;
        return JSON.stringify(refused);
      };
      if ("refuse" in rule) return refusal(rule.refuse);
      if ("without" in rule || "with" in rule) {
        const data: Record<string, unknown> =
          typeof message.data === "object" && message.data !== null
            ? { ...(message.data as Record<string, unknown>) }
            : {};
        if ("without" in rule) {
          for (const [field, gone] of Object.entries(rule.without)) {
            const list = data[field];
            if (Array.isArray(list))
              data[field] = gone.includes("*") ? [] : list.filter((item) => !gone.includes(item));
          }
        } else {
          for (const [field, added] of Object.entries(rule.with)) {
            const list = data[field];
            if (Array.isArray(list))
              data[field] = [...list, ...added.filter((item) => !list.includes(item))];
          }
        }
        return JSON.stringify({ ...message, data });
      }
      if ("afterRefuse" in rule && typeof rule.afterRefuse === "string" && answered.has(rule))
        return refusal(rule.afterRefuse);
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
      // `"{in Ns}"` is the time N s from now: an offer that expires shows its real length.
      const data = JSON.stringify(rule.reply)?.replace(/"\{in (-?\d+)s\}"/g, (_, seconds: string) =>
        JSON.stringify(new Date(Date.now() + Number(seconds) * 1000).toISOString()),
      );
      const body = data === undefined ? "" : `,"data":${data}`;
      return `{"type":"ack","id":${JSON.stringify(message.id)},"ok":true${body}}`;
    },
    swallows(frame) {
      const message = parse(frame);
      return rules.some((r) => "stall" in r && r.command === message?.type);
    },
  };
}

/** The init script a print adds: the page's WebSocket wrapped with `wireRewriter(rules)`. */
export function wireScript(rules: WireRule[]): string {
  return `(${installHolds.toString()})(window, (url) => (${wireRewriter.toString()})(${JSON.stringify(rules)}, url));`;
}
