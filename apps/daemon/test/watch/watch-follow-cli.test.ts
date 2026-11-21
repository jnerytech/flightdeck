import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { runWatchCli } from "../../src/watch/index.ts";
import { config, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { watchedCli } from "../support/cli-watch.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const info = (over: Record<string, unknown> = {}) => ({
  cardId: "c1",
  enabled: true,
  status: "watching",
  reason: null,
  rounds: [],
  roundsUsed: 1,
  maxRounds: 3,
  ...over,
});
const updated = (over: Record<string, unknown> = {}) => ({
  type: "watch.updated",
  watch: info(over),
});

const follow = (
  daemon: ReturnType<typeof fakeDaemon>,
  options: Parameters<typeof watchedCli>[3] & { json?: boolean },
) =>
  watchedCli(
    daemon,
    "watch.watch",
    (cfg, run) =>
      runWatchCli(
        { action: "follow", target: "", ...(options.json ? { json: true } : {}) },
        cfg,
        run,
      ),
    options,
  );

describe("flightdeckd watch follow (issue #3539)", () => {
  test("it writes the watch of each card the daemon pushes, and Ctrl-C ends it with 0", async () => {
    const daemon = fakeDaemon({ "watch.watch": () => ({}) });
    const { result, lines } = await follow(daemon, {
      lines: 2,
      after: () => {
        daemon.push(updated());
        daemon.push(updated({ cardId: "c2", status: "needs_you", reason: "checks keep failing" }));
      },
    });
    expect(lines).toEqual([
      "c1: watching, 1 of 3 rounds used",
      "c2: needs you: checks keep failing, 1 of 3 rounds used",
    ]);
    expect(result.code).toBe(0);
    expect(daemon.calls.filter((c) => c.type === "watch.watch")).toEqual([
      { type: "watch.watch", payload: {} },
    ]);
  });

  test("--json writes one watch per line, with the keys an older daemon leaves out as null", async () => {
    const daemon = fakeDaemon({ "watch.watch": () => ({}) });
    const olderDaemon = { ...info() } as Record<string, unknown>;
    delete olderDaemon.roundsUsed;
    delete olderDaemon.maxRounds;
    const { lines } = await follow(daemon, {
      json: true,
      after: () => daemon.push({ type: "watch.updated", watch: olderDaemon }),
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      cardId: "c1",
      roundsUsed: null,
      maxRounds: null,
      rounds: [],
    });
  });

  test("a daemon that never acks the watch exits 2 in the time limit and writes nothing", async () => {
    const silent = fakeDaemon({});
    const lines: string[] = [];
    const result = await runWatchCli({ action: "follow", target: "" }, config(silent.port), {
      timeoutMs: 200,
      signal: new AbortController().signal,
      write: (l) => lines.push(l),
    });
    expect(result.code).toBe(2);
    expect(lines).toEqual([]);
  });

  test("the words are `watch follow` with no operand, and an operand is refused", () => {
    const argsOf = (argv: string[]) => {
      try {
        return parseArgs(argv);
      } catch (error) {
        return { refusedWith: (error as Error).message };
      }
    };
    expect(argsOf(["watch", "follow"])).toMatchObject({ command: "watch", action: "follow" });
    expect(JSON.stringify(argsOf(["watch", "follow", "c1"]))).toContain("unknown argument: c1");
  });
});
