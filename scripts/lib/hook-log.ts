import { join } from "node:path";
import { gitCommonDir } from "./claude-hooks.ts";

/**
 * The decision log of the project's Claude Code hooks (.claude/hooks): one JSON line per call,
 * so `bun run harness:stats` can show how often each rule blocks and how long the hooks take.
 */

export interface HookLogEntry {
  /** ISO time of the call. */
  t: string;
  /** The hook file, such as `guard` or `biome-on-edit`. */
  hook: string;
  /** The rule that blocked, or null when the call passed. */
  rule: string | null;
  /** `waived`: a commit the gate let through because of its TDD-Waiver trailer. */
  decision: "allow" | "block" | "waived";
  /** Milliseconds from the hook process start to the decision. */
  ms: number;
}

export interface HookLogDeps {
  /** The file's size in bytes, 0 when it does not exist. */
  size: (path: string) => number;
  append: (path: string, text: string) => void;
  rename: (from: string, to: string) => void;
}

/** Appends `entry` as one JSON line; a log past `maxBytes` moves to `<path>.1` first. */
export function appendHookLog(
  path: string,
  entry: HookLogEntry,
  deps: HookLogDeps,
  maxBytes = 1_000_000,
): void {
  if (deps.size(path) >= maxBytes) deps.rename(path, `${path}.1`);
  deps.append(path, `${JSON.stringify(entry)}\n`);
}

/** The log of the repository `projectDir` belongs to: `<common .git>/flightdeck-hooks.jsonl`. */
export function hookLogPath(projectDir: string): string | null {
  const common = gitCommonDir(projectDir);
  return common ? join(common, "flightdeck-hooks.jsonl") : null;
}

/** A table of calls, blocks and p50/p95 milliseconds per hook, then the blocks per rule. */
export function summarizeHookLog(text: string): string {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const entries = lines.map(parseEntry).filter((e): e is HookLogEntry => e !== null);
  if (lines.length === 0) return "no hook calls logged yet";
  const byHook = new Map<string, HookLogEntry[]>();
  const byRule = new Map<string, number>();
  const waivedByRule = new Map<string, number>();
  for (const e of entries) {
    byHook.set(e.hook, [...(byHook.get(e.hook) ?? []), e]);
    const counts = e.decision === "waived" ? waivedByRule : byRule;
    if (e.rule) counts.set(e.rule, (counts.get(e.rule) ?? 0) + 1);
  }
  const hookWidth = Math.max(4, ...[...byHook.keys()].map((h) => h.length)) + 2;
  const out = [`${"hook".padEnd(hookWidth)}calls  blocks  p50 ms  p95 ms`];
  for (const [hook, calls] of [...byHook].sort(([a], [b]) => a.localeCompare(b))) {
    const ms = calls.map((c) => c.ms).sort((a, b) => a - b);
    const blocks = calls.filter((c) => c.decision === "block").length;
    out.push(
      `${hook.padEnd(hookWidth)}${String(calls.length).padStart(5)}${String(blocks).padStart(8)}${String(percentile(ms, 0.5)).padStart(8)}${String(percentile(ms, 0.95)).padStart(8)}`,
    );
  }
  for (const [title, counts] of [
    ["blocks by rule:", byRule],
    ["waivers by rule:", waivedByRule],
  ] as const) {
    if (counts.size === 0) continue;
    const ruleWidth = Math.max(...[...counts.keys()].map((r) => r.length)) + 2;
    out.push("", title);
    for (const [rule, n] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
      out.push(`  ${rule.padEnd(ruleWidth)}${n}`);
    }
  }
  const skipped = lines.length - entries.length;
  if (skipped > 0) out.push("", `${skipped} line(s) skipped (not a hook log entry)`);
  return out.join("\n");
}

/** Nearest-rank percentile of sorted values, rounded to whole milliseconds. */
function percentile(sorted: number[], p: number): number {
  return Math.round(sorted[Math.ceil(p * sorted.length) - 1] ?? 0);
}

function parseEntry(line: string): HookLogEntry | null {
  try {
    const e = JSON.parse(line);
    const ok =
      typeof e?.hook === "string" &&
      typeof e.ms === "number" &&
      ["allow", "block", "waived"].includes(e.decision);
    return ok ? (e as HookLogEntry) : null;
  } catch {
    return null;
  }
}
