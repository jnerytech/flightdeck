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
