import { type FrameRewriter, installHolds } from "./holds.ts";

/**
 * What the host seems to answer to the wand's request (#4168): a suggestion of one line, one of
 * several lines with notes, a refusal, or nothing yet (the request stays pending).
 */
export type AssistantMode = "answers" | "notices" | "refuses" | "pending";

/**
 * The AI assistant prints show a wand that was answered, and a real answer would start Claude on
 * the demo's host. So the page's sockets are wrapped with this: the app's `assistant.run` goes to the
 * host as `host.info`, a command that only reads, and the host's ack is replaced by the answer the
 * print needs (or hidden, for a request left pending). Fake text only (no real key, path or address).
 *
 * It goes into the page as its source (`assistantScript`), so it uses nothing outside its own body.
 */
// Not instrumented: its source goes into the page, where an istanbul counter would not exist
// (the istanbul shard of a full run, #1492).
/* istanbul ignore next */
export function assistantRewriter(mode: AssistantMode): FrameRewriter {
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
  const usage = { inputTokens: 120, outputTokens: 48, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const result = (text: string, notices: string[]) => ({
    text,
    model: "claude-sonnet-5-5",
    provider: "host",
    usage,
    stopReason: "end_turn",
    notices,
  });
  const answers: Record<"answers" | "notices", unknown> = {
    answers: result("Corrige o total da compra.", []),
    notices: result("Corrige o total da compra.\nAplica o desconto do cupom.\nMostra o frete.", [
      "lines_redacted",
      "diff_truncated",
    ]),
  };
  const refusal = {
    code: "failed",
    message: "Claude Code on the host cannot answer.",
    reason: "assistant_host_unavailable",
    params: { detail: "it is not signed in" },
  };
  const asked = new Set<string>();
  return {
    fromApp(frame) {
      const message = parse(frame);
      if (message?.type !== "assistant.run" || typeof message.id !== "string") return frame;
      asked.add(message.id);
      return JSON.stringify({ id: message.id, type: "host.info", payload: {} });
    },
    fromHost(frame) {
      const message = parse(frame);
      const id = message?.id;
      if (message?.type !== "ack" || typeof id !== "string" || !asked.has(id)) return frame;
      asked.delete(id);
      if (message.ok !== true) return frame;
      if (mode === "pending") return frame;
      if (mode === "refuses") return JSON.stringify({ id, type: "ack", ok: false, error: refusal });
      return JSON.stringify({ id, type: "ack", ok: true, data: answers[mode] });
    },
    drops(frame) {
      const message = parse(frame);
      const id = message?.id;
      return (
        mode === "pending" && message?.type === "ack" && typeof id === "string" && asked.has(id)
      );
    },
  };
}

/** The init script a print adds: the page's WebSocket wrapped with `assistantRewriter`. */
export function assistantScript(mode: AssistantMode): string {
  return `(${installHolds.toString()})(window, () => (${assistantRewriter.toString()})(${JSON.stringify(mode)}));`;
}
