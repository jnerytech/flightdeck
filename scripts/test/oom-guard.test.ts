import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OOM_SCORE_ADJ, offerToOomKiller } from "../lib/oom-guard.ts";

describe("oom-guard", () => {
  test("on Linux this process's own oom_score_adj becomes 1000, and nothing else is written", () => {
    const writes: [string, string][] = [];
    const set = offerToOomKiller({
      platform: "linux",
      write: (path, data) => writes.push([path, data]),
    });
    expect(set).toBe(true);
    expect(writes).toEqual([["/proc/self/oom_score_adj", "1000"]]);
    expect(OOM_SCORE_ADJ).toBe(1000);
  });

  test("on Windows and macOS nothing is written", () => {
    for (const platform of ["win32", "darwin"] as const) {
      const writes: string[] = [];
      expect(offerToOomKiller({ platform, write: (path) => writes.push(path) })).toBe(false);
      expect(writes).toEqual([]);
    }
  });

  test("a /proc that refuses (read-only, a container) never stops the command", () => {
    const refuse = () => {
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    };
    expect(offerToOomKiller({ platform: "linux", write: refuse })).toBe(false);
  });

  test.skipIf(process.platform !== "linux")(
    "the preload already made this test run the OOM killer's first choice",
    () => {
      expect(readFileSync("/proc/self/oom_score_adj", "utf8").trim()).toBe("1000");
    },
  );
});
