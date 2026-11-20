import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OnProcessEvent, ProcessEventName } from "../../src/kernel/index.ts";
import { traceProcessEnd } from "../../src/logs/process-trace.ts";
import { createHostLog } from "../../src/logs/wiring.ts";
import { runCli } from "../../src/main.ts";
import { tempDir } from "../support/helpers.ts";

/**
 * How the daemon's end is traced (#3403): an error nobody caught, or an exit nobody logged, leaves
 * one line in the daemon's log file before the process ends. The process's events are fired by hand.
 */
const TOKEN = "Zk3fakeprotocoltoken0123456789abcdefghijklmnop";

/** The events a process would emit, held so the test can fire them. */
function fakeProcess() {
  const handlers = new Map<ProcessEventName, Array<(arg: unknown) => void>>();
  const on: OnProcessEvent = (event, handler) => {
    handlers.set(event, [...(handlers.get(event) ?? []), handler]);
  };
  const fire = (event: ProcessEventName, arg: unknown) => {
    for (const handler of handlers.get(event) ?? []) handler(arg);
  };
  return { on, fire, handlers };
}

function traced() {
  const dir = tempDir("fd-trace-");
  const { fileLog } = createHostLog({
    console: { log: () => {}, error: () => {} },
    dir,
    home: "/home/dev",
    config: { token: TOKEN, hooks: {} },
    currentToken: () => TOKEN,
    heldValues: () => [],
  });
  const proc = fakeProcess();
  const exits: number[] = [];
  const reports: string[] = [];
  const trace = traceProcessEnd(
    proc.on,
    (code) => exits.push(code),
    fileLog,
    (line) => reports.push(line),
  );
  const lines = () => {
    const file = join(dir, "flightdeckd.log");
    return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
  };
  return { proc, exits, reports, trace, lines, dir };
}

describe("process-trace: the daemon's end leaves a line", () => {
  test("a rejection nobody caught is one line with the error and its stack, and the process ends with 1", () => {
    const { proc, exits, lines } = traced();
    const error = new Error("run is not a workflow");
    proc.fire("unhandledRejection", error);
    expect(exits).toEqual([1]);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain("ERROR");
    expect(lines()[0]).toContain("unhandledRejection");
    expect(lines()[0]).toContain("run is not a workflow");
    // The stack is in the line (the home folder in its paths is `~`, so the file name is what is looked for).
    expect(lines()[0]).toContain("process-trace.test.ts");
  });

  test("a thrown error nobody caught is traced the same way, and a value that is not an Error is shown as text", () => {
    const { proc, exits, lines } = traced();
    proc.fire("uncaughtException", new Error("boom"));
    expect(lines()[0]).toContain("uncaughtException");
    expect(lines()[0]).toContain("boom");
    const second = traced();
    second.proc.fire("unhandledRejection", "plain text reason");
    expect(second.lines()[0]).toContain("plain text reason");
    expect([exits, second.exits]).toEqual([[1], [1]]);
  });

  test("the daemon's tokens never reach the line", () => {
    const { proc, lines } = traced();
    proc.fire("unhandledRejection", new Error(`bad header ${TOKEN}`));
    expect(lines()[0]).not.toContain(TOKEN);
    expect(lines()[0]).toContain("bad header [redacted]");
  });

  test("a crash is also said on the console: the handler replaces the runtime's own report, and the log file may not be writable", () => {
    const { proc, reports } = traced();
    proc.fire("unhandledRejection", new Error(`bad header ${TOKEN}`));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("unhandledRejection");
    expect(reports[0]).toContain("bad header [redacted]");
    expect(reports[0]).not.toContain(TOKEN);
  });

  test("an error that comes while the daemon is stopping is still traced", () => {
    const { proc, trace, exits, lines } = traced();
    trace.stopped();
    proc.fire("uncaughtException", new Error("closing failed"));
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain("closing failed");
    expect(exits).toEqual([1]);
  });

  test("an exit nobody logged is one line with its code", () => {
    const { proc, exits, lines } = traced();
    proc.fire("exit", 3);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain("exit code 3");
    expect(exits).toEqual([]);
  });

  test("a crash is one line, not two: the exit its own handler asks for is not traced again", () => {
    const { proc, lines } = traced();
    proc.fire("unhandledRejection", new Error("boom"));
    proc.fire("exit", 1);
    expect(lines()).toHaveLength(1);
  });

  test("a clean stop adds no line when the process then exits", () => {
    const { proc, trace, lines } = traced();
    trace.stopped();
    proc.fire("exit", 0);
    expect(lines()).toEqual([]);
  });
});

describe("process-trace: wired from runCli", () => {
  const boot = async (events: ReturnType<typeof fakeProcess>) => {
    const home = tempDir("fd-trace-home-");
    const file = join(home, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token: "t".repeat(32),
        runtime: "fake",
        dataDir: join(home, "data"),
      }),
    );
    const handlers = new Map<string, () => Promise<void>>();
    const exits: number[] = [];
    const daemon = await runCli(["--config", file], {
      env: { HOME: home, USERPROFILE: home },
      log: { log: () => {}, error: () => {} },
      exit: (code) => exits.push(code),
      onSignal: (signal, handler) => handlers.set(signal, handler),
      onProcessEvent: events.on,
    });
    const text = async () => {
      await daemon?.logger.log("flush");
      const log = join(home, ".flightdeck", "logs", "flightdeckd.log");
      return existsSync(log) ? readFileSync(log, "utf8") : "";
    };
    return { daemon, handlers, exits, text };
  };

  test("a daemon that starts traces an uncaught error in its file log and ends with 1", async () => {
    const events = fakeProcess();
    const { handlers, exits, text } = await boot(events);
    expect([...events.handlers.keys()].sort()).toEqual([
      "exit",
      "uncaughtException",
      "unhandledRejection",
    ]);
    events.fire("unhandledRejection", new Error("failRun threw"));
    expect(exits).toEqual([1]);
    expect(await text()).toContain("failRun threw");
    await handlers.get("SIGTERM")?.();
  });

  test("a stop by SIGTERM leaves no exit line beyond its shutdown line", async () => {
    const events = fakeProcess();
    const { handlers, exits, text } = await boot(events);
    await handlers.get("SIGTERM")?.();
    events.fire("exit", 0);
    expect(exits).toEqual([0]);
    expect(await text()).not.toContain("exit code");
  });

  test("without the seam the daemon registers no process handler", async () => {
    const events = fakeProcess();
    const home = tempDir("fd-trace-home-");
    const file = join(home, "config.json");
    writeFileSync(
      file,
      JSON.stringify({ port: 0, token: "t".repeat(32), runtime: "fake", dataDir: join(home, "d") }),
    );
    const handlers = new Map<string, () => Promise<void>>();
    await runCli(["--config", file], {
      env: { HOME: home, USERPROFILE: home },
      log: { log: () => {}, error: () => {} },
      exit: () => {},
      onSignal: (signal, handler) => handlers.set(signal, handler),
    });
    expect(events.handlers.size).toBe(0);
    await handlers.get("SIGTERM")?.();
  });
});
