import { describe, expect, test } from "bun:test";
import { diagnosticsText } from "../../src/features/settings/domain/diagnostics-text.ts";

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

  test("a home folder is ~ in the diagnostics", () => {
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
