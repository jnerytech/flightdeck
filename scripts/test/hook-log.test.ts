import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendHookLog,
  type HookLogEntry,
  hookLogPath,
  summarizeHookLog,
} from "../lib/hook-log.ts";
import { realTempDir } from "./temp-dir.ts";

const entry = (hook: string, ms: number, rule: string | null = null): HookLogEntry => ({
  t: "2026-11-04T23:00:00.000Z",
  hook,
  rule,
  decision: rule ? "block" : "allow",
  ms,
});

function fakeFs(sizes: Record<string, number>) {
  const ops: string[] = [];
  return {
    ops,
    deps: {
      size: (path: string) => sizes[path] ?? 0,
      append: (path: string, text: string) => ops.push(`append ${path} ${text}`),
      rename: (from: string, to: string) => ops.push(`rename ${from} ${to}`),
    },
  };
}

describe("hook-log", () => {
  test("an entry is appended as one JSON line", () => {
    const fs = fakeFs({});
    appendHookLog("/r/.git/flightdeck-hooks.jsonl", entry("guard", 42, "commit"), fs.deps);
    expect(fs.ops).toEqual([
      `append /r/.git/flightdeck-hooks.jsonl ${JSON.stringify(entry("guard", 42, "commit"))}\n`,
    ]);
  });

  test("a log past the size limit moves to .1 before the append", () => {
    const fs = fakeFs({ "/r/log": 1000 });
    appendHookLog("/r/log", entry("guard", 1), fs.deps, 1000);
    expect(fs.ops).toEqual([
      "rename /r/log /r/log.1",
      `append /r/log ${JSON.stringify(entry("guard", 1))}\n`,
    ]);
    const small = fakeFs({ "/r/log": 999 });
    appendHookLog("/r/log", entry("guard", 1), small.deps, 1000);
    expect(small.ops.length).toBe(1);
  });

  test("the log lives in the common .git of the main checkout and of its worktrees", () => {
    const base = realTempDir("fd-HookLog-");
    const main = join(base, "Flightdeck");
    const worktree = join(base, "flightdeck-fase39");
    mkdirSync(join(main, ".git", "worktrees", "flightdeck-fase39"), { recursive: true });
    mkdirSync(worktree, { recursive: true });
    writeFileSync(
      join(worktree, ".git"),
      `gitdir: ${join(main, ".git", "worktrees", "flightdeck-fase39")}\n`,
    );
    const expected = join(main, ".git", "flightdeck-hooks.jsonl");
    expect(hookLogPath(main)).toBe(expected);
    expect(hookLogPath(worktree)).toBe(expected);
    expect(hookLogPath(base)).toBeNull();
  });

  test("the summary counts calls, blocks and p50/p95 per hook, then blocks per rule", () => {
    const lines = [
      ...[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((ms) => entry("guard", ms)),
      entry("guard", 200, "commit"),
      entry("guard", 5, "test-marker"),
      entry("biome-on-edit", 1900),
      entry("biome-on-edit", 2100, "biome"),
    ].map((e) => JSON.stringify(e));
    lines.push("not json", '{"hook":"guard"}', "");
    expect(summarizeHookLog(lines.join("\n"))).toBe(
      [
        "hook           calls  blocks  p50 ms  p95 ms",
        "biome-on-edit      2       1    1900    2100",
        "guard             12       2      50     200",
        "",
        "blocks by rule:",
        "  biome        1",
        "  commit       1",
        "  test-marker  1",
        "",
        "2 line(s) skipped (not a hook log entry)",
      ].join("\n"),
    );
  });

  test("waived commits are counted apart from blocks, per rule", () => {
    const waived: HookLogEntry = { ...entry("guard", 40), rule: "commit", decision: "waived" };
    const text = [entry("guard", 30), waived, waived].map((e) => JSON.stringify(e)).join("\n");
    expect(summarizeHookLog(text)).toBe(
      [
        "hook   calls  blocks  p50 ms  p95 ms",
        "guard      3       0      40      40",
        "",
        "waivers by rule:",
        "  commit  2",
      ].join("\n"),
    );
  });

  test("commitWaived tells a commit that carries a TDD-Waiver trailer", () => {
    expect(commitWaived('git commit -m "fix(a): x" -m "TDD-Waiver: made in the rc merge"')).toBe(
      true,
    );
    expect(commitWaived('git commit -m "fix(a): x" --trailer "TDD-Waiver: why"')).toBe(true);
    expect(commitWaived('git commit -m "fix(a): x"')).toBe(false);
    expect(commitWaived('echo "TDD-Waiver: x"')).toBe(false);
  });

  test("an empty log says so", () => {
    expect(summarizeHookLog("")).toBe("no hook calls logged yet");
  });
});
