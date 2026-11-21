import { describe, expect, test } from "bun:test";
import { messageAdminRun } from "../../src/cli/message-admin-run.ts";

/** What `messageAdminRun` registers for a verb, and what its runner prints with no daemon to ask. */
function run(action: "history" | "watch" | "rules") {
  const signals: string[] = [];
  const handlers: Array<() => Promise<void>> = [];
  const lines: string[] = [];
  const asking = messageAdminRun(
    { action },
    {
      onSignal: (signal, handler) => {
        signals.push(signal);
        handlers.push(handler);
      },
      log: { log: (line) => void lines.push(line) },
    },
  );
  return { signals, handlers, lines, asking };
}

describe("message-admin-run (issue #3622)", () => {
  test("only watch listens for Ctrl-C and a termination request", () => {
    expect(run("watch").signals).toEqual(["SIGINT", "SIGTERM"]);
    expect(run("history").signals).toEqual([]);
    expect(run("rules").signals).toEqual([]);
  });

  test("a signal stops the watch without a handler throwing", async () => {
    const { handlers } = run("watch");
    for (const stop of handlers) await stop();
    expect(handlers).toHaveLength(2);
  });

  test("with no daemon listening the runner exits 2 and says so", async () => {
    const { asking } = run("rules");
    const result = await asking({ bind: "127.0.0.1", port: 1, token: "t" });
    expect(result.code).toBe(2);
  });
});
