import { describe, expect, test } from "bun:test";
import { AppLog, diagnosticsText, installGlobalLog } from "../src/lib/app-log.ts";
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
    write: async (line) => void written.push(line),
    tail: async () => [],
    openFolder: async () => {},
  };
  return { s, written };
}

describe("log-app: the app's log (issue #255)", () => {
  test("a line carries its time, level and source, on one line", () => {
    const { s, written } = sink();
    const log = new AppLog({ sink: s, now: () => NOW });
    log.log("error", "host", "alfa went offline\nretrying in 5 s");
    log.log("info", "update", "no newer version");
    expect(written).toEqual([
      "2026-11-05T12:00:00.000Z ERROR host alfa went offline retrying in 5 s",
      "2026-11-05T12:00:00.000Z INFO update no newer version",
    ]);
  });

  test("no secret reaches the file or the memory: every line is redacted first", () => {
    const { s, written } = sink();
    const log = new AppLog({ sink: s, now: () => NOW });
    for (const secret of SECRETS) log.log("error", "host", `refused: ${secret}`);
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
    const log = new AppLog({ now: () => NOW });
    for (let i = 0; i < 250; i++) log.log("info", "t", `n${i}`);
    expect(log.recent(1000)).toHaveLength(200);
    expect(log.recent(3).map((l) => l.split(" ").pop())).toEqual(["n247", "n248", "n249"]);
    expect(log.recent(0)).toEqual([]);
  });

  test("a message is cut to a sensible size, and a sink that fails does not break the app", async () => {
    const written: string[] = [];
    const failing: LogSink = {
      write: async (line) => {
        written.push(line);
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

  test("an error, an unhandled rejection and a console error become lines, and it can be taken off", () => {
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
    expect(written).toHaveLength(4);
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

  test("values given to the log are removed, read at each line", () => {
    const { s, written } = sink();
    let values: string[] = [];
    const log = new AppLog({ sink: s, now: () => NOW, values: () => values });
    log.log("error", "host", `refused ${HOST_TOKEN}`);
    expect(written[0]).toContain(HOST_TOKEN);
    values = [HOST_TOKEN];
    log.log("error", "host", `refused ${HOST_TOKEN}`);
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
    const fakeConsole = { error: () => {}, warn: () => {} };
    const off = installGlobalLog(t, log, fakeConsole);
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    fakeConsole.error(circular);
    off();
    expect(written.at(-1)).toContain("ERROR console [object Object]");
  });
});
