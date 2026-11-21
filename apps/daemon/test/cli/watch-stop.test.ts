import { describe, expect, test } from "bun:test";
import type { CliArgs } from "../../src/cli/domain/cli-args.ts";
import { watchStop } from "../../src/cli/watch-stop.ts";

type Signal = "SIGINT" | "SIGTERM";

function listening(args: Partial<CliArgs>) {
  const handlers = new Map<Signal, () => Promise<void>>();
  const stop = watchStop(args as CliArgs, { onSignal: (s, h) => void handlers.set(s, h) });
  return { stop, handlers };
}

describe("watchStop (issue #3621)", () => {
  test("a streaming command stops on Ctrl-C and on a stop of the process, and not before", async () => {
    for (const action of ["watch", "follow"] as const) {
      const { stop, handlers } = listening({ action });
      expect([...handlers.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);
      expect(stop.signal.aborted).toBe(false);
      await handlers.get("SIGINT")?.();
      expect(stop.signal.aborted).toBe(true);
    }
  });

  test("any other command leaves Ctrl-C alone, so it ends the process", () => {
    const { stop, handlers } = listening({ action: "get" });
    expect(handlers.size).toBe(0);
    expect(stop.signal.aborted).toBe(false);
  });
});
