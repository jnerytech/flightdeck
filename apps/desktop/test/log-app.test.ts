import { describe, expect, test } from "bun:test";
import {
  AppLog,
  diagnosticsText,
  installGlobalLog,
  LOG_BURST,
  LOG_QUEUE,
} from "../src/lib/app-log.ts";
import type { LogSink } from "../src/platform/types.ts";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const SECRETS = [
  "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  "Bearer abcdefghijklmnopqrstuvwxyz012345",
  "token=0123456789abcdef0123456789abcdef",
  "sk-abcdefghijklmnopqrstuvwx",
  "https://user:pa55word@example.com/x",
];

function sink() {
  const written: string[] = [];
  const s: LogSink = {
    write: async (lines) => void written.push(...lines),
    tail: async () => [],
    openFolder: async () => {},
  };
  return { s, written };
}

describe("log-app: the app's log (issue #255)", () => {
  test("a line carries its time, level and source, on one line", async () => {
    const { s, written } = sink();
    const log = new AppLog({ sink: s, now: () => NOW });
    log.log("error", "host", "alfa went offline\nretrying in 5 s");
    log.log("info", "update", "no newer version");
    await log.flush();
    expect(written).toEqual([
      "2026-11-05T12:00:00.000Z ERROR host alfa went offline retrying in 5 s",
      "2026-11-05T12:00:00.000Z INFO update no newer version",
    ]);
  });

  test("no secret reaches the file or the memory: every line is redacted first", async () => {
    const { s, written } = sink();
    const log = new AppLog({ sink: s, now: () => NOW });
    for (const secret of SECRETS) log.log("error", "host", `refused: ${secret}`);
    await log.flush();
    expect(written).toHaveLength(SECRETS.length);
    expect(log.recent(50)).toHaveLength(SECRETS.length);
    const everything = [...written, ...log.recent(50)].join("\n");
    for (const needle of [
      "ghp_abcdefghijklmnopqrstuvwxyz",
      "abcdefghijklmnopqrstuvwxyz012345",
      "0123456789abcdef0123456789abcdef",
      "sk-abcdefghijklmnopqrstuvwx",
      "pa55word",
    ]) {
      expect(everything).not.toContain(needle);
    }
    expect(written.every((line) => line.includes("[redacted]"))).toBe(true);
  });

  test("the last lines are kept in memory, 200 at most, newest last", () => {
    // A second between lines: under the rate limit (#259), so every line is kept.
    let clock = NOW;
    const log = new AppLog({ now: () => (clock += 1000) });
    for (let i = 0; i < 250; i++) log.log("info", "t", `n${i}`);
    expect(log.recent(1000)).toHaveLength(200);
    expect(log.recent(3).map((l) => l.split(" ").pop())).toEqual(["n247", "n248", "n249"]);
    expect(log.recent(0)).toEqual([]);
  });

  test("a message is cut to a sensible size, and a sink that fails does not break the app", async () => {
    const written: string[] = [];
    const failing: LogSink = {
      write: async (lines) => {
        written.push(...lines);
        throw new Error("disk full");
      },
      tail: async () => [],
      openFolder: async () => {},
    };
    const log = new AppLog({ sink: failing, now: () => NOW });
    expect(() => log.log("info", "t", "x".repeat(10_000))).not.toThrow();
    await Promise.resolve();
    expect(written).toHaveLength(1);
    expect((written[0] ?? "").length).toBeLessThan(2200);
  });
});

describe("log-app: what the webview reports on its own", () => {
  function target() {
    const listeners = new Map<string, (event: never) => void>();
    return {
      listeners,
      addEventListener: (type: string, fn: (event: never) => void) => void listeners.set(type, fn),
      removeEventListener: (type: string) => void listeners.delete(type),
    };
  }

  test("an error, an unhandled rejection and a console error become lines, and it can be taken off", async () => {
    const { s, written } = sink();
    const log = new AppLog({ sink: s, now: () => NOW });
    const t = target();
    const calls: unknown[][] = [];
    const fakeConsole = {
      error: (...args: unknown[]) => void calls.push(["error", ...args]),
      warn: (...args: unknown[]) => void calls.push(["warn", ...args]),
    };
    const off = installGlobalLog(t, log, fakeConsole);
    (t.listeners.get("error") as (e: unknown) => void)({
      message: "boom",
      filename: "app.js",
      lineno: 7,
    });
    (t.listeners.get("unhandledrejection") as (e: unknown) => void)({ reason: new Error("nope") });
    fakeConsole.error("a", { b: 1 });
    fakeConsole.warn("careful");
    await log.flush();
    expect(written.map((l) => l.replace(/^\S+ /, ""))).toEqual([
      "ERROR window boom (app.js:7)",
      "ERROR rejection nope",
      'ERROR console a {"b":1}',
      "WARN console careful",
    ]);
    // The original console still got the calls.
    expect(calls).toHaveLength(2);
    off();
    expect(t.listeners.size).toBe(0);
    fakeConsole.error("after");
    await log.flush();
    expect(written).toHaveLength(4);
  });
});

/** A sink whose writes wait until the test settles them, one call per batch (#259). */
function heldSink() {
  const calls: string[][] = [];
  const pending: Array<{ ok: () => void; fail: () => void }> = [];
  const s: LogSink = {
    write: (lines) =>
      new Promise<void>((ok, fail) => {
        calls.push([...lines]);
        pending.push({ ok, fail: () => fail(new Error("disk full")) });
      }),
    tail: async () => [],
    openFolder: async () => {},
  };
  const settle = async (how: "ok" | "fail" = "ok") => {
    pending.shift()?.[how]();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { s, calls, settle };
}

const body = (line: string | undefined) => (line ?? "").replace(/^\S+ /, "");

describe("log-app: a log storm reaches neither the disk nor the IPC whole (issue #259)", () => {
  test("the first line goes at once; what comes while it is written goes in one next call", async () => {
    const held = heldSink();
    const log = new AppLog({ sink: held.s, now: () => NOW });
    log.log("info", "a", "one");
    log.log("info", "b", "two");
    log.log("info", "c", "three");
    expect(held.calls.map((call) => call.map(body))).toEqual([["INFO a one"]]);
    await held.settle();
    expect(held.calls.map((call) => call.map(body))).toEqual([
      ["INFO a one"],
      ["INFO b two", "INFO c three"],
    ]);
  });

  test("a write that fails still lets the lines waiting behind it go", async () => {
    const held = heldSink();
    const log = new AppLog({ sink: held.s, now: () => NOW });
    log.log("info", "a", "one");
    log.log("info", "b", "two");
    await held.settle("fail");
    expect(held.calls.map((call) => call.map(body))).toEqual([["INFO a one"], ["INFO b two"]]);
  });

  test("flush waits for every line to be written, and resolves at once with no sink", async () => {
    const { s, written } = sink();
    const log = new AppLog({ sink: s, now: () => NOW });
    for (const word of ["one", "two", "three"]) log.log("info", word, word);
    await log.flush();
    expect(written.map(body)).toEqual(["INFO one one", "INFO two two", "INFO three three"]);
    const bare = new AppLog({ now: () => NOW });
    bare.log("info", "t", "x");
    expect(await bare.flush()).toBeUndefined();
  });

  test("a source past its rate is cut and counted, without starving the others, and says so when it comes back", async () => {
    const { s, written } = sink();
    let clock = NOW;
    const log = new AppLog({ sink: s, now: () => clock });
    for (let i = 0; i < LOG_BURST + 30; i++) log.log("error", "console", `storm ${i}`);
    log.log("warn", "host", "alfa: offline");
    await log.flush();
    expect([
      written.filter((line) => line.includes(" console storm ")).length,
      log.recent(1000).filter((line) => line.includes(" console storm ")).length,
      written.some((line) => line.endsWith("WARN host alfa: offline")),
    ]).toEqual([LOG_BURST, LOG_BURST, true]);
    clock += 1000;
    log.log("error", "console", "after the storm");
    await log.flush();
    expect(written.slice(-2).map(body)).toEqual([
      "WARN app-log 30 lines of console dropped by the rate limit",
      "ERROR console after the storm",
    ]);
    // A long quiet refills the source only up to its burst.
    clock += 3_600_000;
    const before = written.length;
    for (let i = 0; i < LOG_BURST + 10; i++) log.log("info", "console", `again ${i}`);
    await log.flush();
    expect(written.slice(before).filter((line) => line.includes(" again ")).length).toBe(LOG_BURST);
  });

  test("a sink that cannot keep up holds a bounded queue and counts what it had to drop", async () => {
    const held = heldSink();
    const log = new AppLog({ sink: held.s, now: () => NOW });
    // Each line from its own source: the queue, not the rate limit, is what fills.
    for (let i = 0; i < LOG_QUEUE + 100; i++) log.log("info", `s${i}`, "x");
    await held.settle();
    const second = held.calls[1] ?? [];
    expect([held.calls.length, second.length, body(second[0]), body(second.at(-1))]).toEqual([
      2,
      LOG_QUEUE + 1,
      "WARN app-log 99 lines dropped: the log file could not keep up",
      `INFO s${LOG_QUEUE} x`,
    ]);
  });

  test("a log made inside a log is dropped, not looped: a sink that reports through the console", async () => {
    const written: string[] = [];
    const printed: unknown[][] = [];
    const fakeConsole = {
      error: (...args: unknown[]) => void printed.push(args),
      warn: (...args: unknown[]) => void printed.push(args),
    };
    let hops = 0;
    const loud: LogSink = {
      write: async (lines) => {
        written.push(...lines);
        // A sink that complains on the console, which the log forwards back to the sink. The
        // test stops after a few hops, so the old code fails by assertion, not by the stack.
        if (hops++ < 5) fakeConsole.error("write saw", lines.length);
      },
      tail: async () => [],
      openFolder: async () => {},
    };
    const log = new AppLog({ sink: loud, now: () => NOW });
    const t = { addEventListener: () => {}, removeEventListener: () => {} };
    const off = installGlobalLog(t, log, fakeConsole);
    fakeConsole.error("boom");
    await log.flush();
    off();
    expect([written.map(body), log.recent(50).length, printed.length]).toEqual([
      ["ERROR console boom"],
      1,
      2,
    ]);
  });

  test("a scanner value that logs while a line is redacted does not loop either", async () => {
    const { s, written } = sink();
    let log: AppLog | null = null;
    let asked = 0;
    log = new AppLog({
      sink: s,
      now: () => NOW,
      values: () => {
        if (asked++ < 5) log?.log("warn", "vault", "read while redacting");
        return [];
      },
    });
    log.log("info", "t", "x");
    await log.flush();
    expect(written.map(body)).toEqual(["INFO t x"]);
  });

  test("installing twice on the same console forwards each call once", async () => {
    const { s, written } = sink();
    const log = new AppLog({ sink: s, now: () => NOW });
    const t = { addEventListener: () => {}, removeEventListener: () => {} };
    const fakeConsole = { error: (..._args: unknown[]) => {}, warn: (..._args: unknown[]) => {} };
    const off = installGlobalLog(t, log, fakeConsole);
    const again = installGlobalLog(t, log, fakeConsole);
    fakeConsole.error("once");
    again();
    fakeConsole.warn("still on");
    off();
    fakeConsole.error("off");
    await log.flush();
    expect(written.map(body)).toEqual(["ERROR console once", "WARN console still on"]);
  });
});

describe("log-app: the diagnostics a person pastes", () => {
  const input = {
    appVersion: "0.37.0",
    os: "Windows 11",
    hosts: [
      { name: "pc", version: "0.37.0", features: ["costs", "logs"], status: "online" },
      { name: "pi", version: null, features: [], status: "offline" },
    ],
    lines: ["2026 INFO a", "2026 ERROR b token=0123456789abcdef0123456789abcdef"],
  };

  test("version, system, each host with its version and features, then the log lines", () => {
    const text = diagnosticsText(input);
    expect(text).toContain("Flightdeck 0.37.0");
    expect(text).toContain("Windows 11");
    expect(text).toContain("pc: online, flightdeckd 0.37.0, features: costs, logs");
    expect(text).toContain("pi: offline, flightdeckd unknown, features: none");
    expect(text.indexOf("2026 INFO a")).toBeGreaterThan(text.indexOf("pi:"));
  });

  test("the log lines are redacted again, and only the last 50 go in", () => {
    const text = diagnosticsText({
      ...input,
      lines: Array.from(
        { length: 80 },
        (_, i) => `line ${i} token=0123456789abcdef0123456789abcdef`,
      ),
    });
    expect(text).not.toContain("0123456789abcdef0123456789abcdef");
    expect(text).toContain("line 79");
    expect(text).toContain("line 30");
    expect(text).not.toContain("line 29 ");
  });
});

describe("log-segredos-app: the app's log knows the app's own secrets (issue #255)", () => {
  const HOST_TOKEN = "Zk3fakehosttoken0123456789abcdefghijklmnop";
  const VAULT_VALUE = "Vx9fakevaultvalue0123456789";

  test("values given to the log are removed, read at each line", async () => {
    const { s, written } = sink();
    let values: string[] = [];
    const log = new AppLog({ sink: s, now: () => NOW, values: () => values });
    log.log("error", "host", `refused ${HOST_TOKEN}`);
    expect(written[0]).toContain(HOST_TOKEN);
    values = [HOST_TOKEN];
    log.log("error", "host", `refused ${HOST_TOKEN}`);
    await log.flush();
    expect(written[1]).toBe("2026-11-05T12:00:00.000Z ERROR host refused [redacted]");
    expect(log.recent(5).join("\n").split(HOST_TOKEN)).toHaveLength(2);
  });

  test("a log line never keeps a secret because it holds {{ }}", () => {
    const { s, written } = sink();
    const log = new AppLog({ sink: s, now: () => NOW });
    log.log("error", "x", "password=hunter2hunter2{{x}}");
    expect(written[0]).not.toContain("hunter2");
  });
});

describe("log-privacidade-app: the user's name is not in the app's log (issue #255)", () => {
  test("a home folder is ~ in the file, in the memory and in the diagnostics", () => {
    const { s, written } = sink();
    const log = new AppLog({ sink: s, now: () => NOW });
    log.log("error", "update", "cannot write C:\\Users\\Ana\\AppData\\x and /Users/Ana/y");
    expect(written[0]).toContain("cannot write ~\\AppData\\x and ~/y");
    expect(log.recent(1).join("")).not.toContain("Ana");
    const text = diagnosticsText({
      appVersion: "1",
      os: "Windows (C:\\Users\\Ana\\x)",
      hosts: [{ name: "/home/ana/box", version: null, features: [], status: "online" }],
      lines: ["2026 INFO from /home/ana/z"],
    });
    expect(text).not.toContain("ana");
    expect(text).not.toContain("Ana");
  });
});

describe("log-cobertura-app: failures that never reach the caller (issue #255)", () => {
  test("a sink that throws at once is as harmless as one that fails later", () => {
    const log = new AppLog({
      sink: {
        write: () => {
          throw new Error("sink broke");
        },
        tail: async () => [],
        openFolder: async () => {},
      },
      now: () => NOW,
    });
    expect(() => log.log("error", "x", "still here")).not.toThrow();
    expect(log.recent(1).join("")).toContain("still here");
  });

  test("a console call with an object that cannot be turned into JSON is still logged", () => {
    const { s, written } = sink();
    const log = new AppLog({ sink: s, now: () => NOW });
    const t = { addEventListener: () => {}, removeEventListener: () => {} };
    const fakeConsole = { error: (..._args: unknown[]) => {}, warn: (..._args: unknown[]) => {} };
    const off = installGlobalLog(t, log, fakeConsole);
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    fakeConsole.error(circular);
    off();
    expect(written.at(-1)).toContain("ERROR console [object Object]");
  });
});
