import { join } from "node:path";
import { gitCommonDir, printable } from "./claude-hooks.ts";

/**
 * The decision log of the project's Claude Code hooks (.claude/hooks): one JSON line per call,
 * so `bun run harness:stats` can show how often each rule blocks and how long the hooks take.
 */

/** The `hook` of what the slot logs (#833): a run refused or waived over the file limit, a long hold. */
const SLOT = "slot";

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
  /** A waiver's reason, as given (#741: push-wait overrides). */
  detail?: string;
  /** The age in minutes of the PR run a push-wait override cancels. */
  minutes?: number;
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
  const { byHook, byRule, waivedByRule, passesByReason } = tally(entries);
  const out = [
    ...timingRows(byHook),
    ...ruleSection("blocks by rule:", byRule),
    ...ruleSection("waivers by rule:", waivedByRule),
    ...ruleSection("pushes push-wait let through, by reason:", passesByReason),
    ...overrideLines(entries),
    ...longHoldLines(entries),
  ];
  const skipped = lines.length - entries.length;
  if (skipped > 0) out.push("", `${skipped} line(s) skipped (not a hook log entry)`);
  return out.join("\n");
}

/** The entries per hook, the blocks and waivers per rule, and the pushes let through per reason. */
function tally(entries: HookLogEntry[]) {
  const byHook = new Map<string, HookLogEntry[]>();
  const byRule = new Map<string, number>();
  const waivedByRule = new Map<string, number>();
  const passesByReason = new Map<string, number>();
  for (const e of entries) {
    // The slot is no hook: its entries take no time to decide, so they stay out of the timings (#833).
    if (e.hook !== SLOT) byHook.set(e.hook, [...(byHook.get(e.hook) ?? []), e]);
    // #741: a push push-wait let through is no block: counted by its reason.
    if (e.rule === "push-wait" && e.decision === "allow") {
      const reason = printable(e.detail ?? "?");
      passesByReason.set(reason, (passesByReason.get(reason) ?? 0) + 1);
      continue;
    }
    // A long hold is no block and no waiver: it has its own section (#865 review: only it).
    const counts = e.decision === "waived" ? waivedByRule : byRule;
    if (e.rule && e.rule !== "long-hold") counts.set(e.rule, (counts.get(e.rule) ?? 0) + 1);
  }
  return { byHook, byRule, waivedByRule, passesByReason };
}

/** The header and one row per hook: calls, blocks and p50/p95 milliseconds. */
function timingRows(byHook: Map<string, HookLogEntry[]>): string[] {
  const hookWidth = Math.max(4, ...[...byHook.keys()].map((h) => h.length)) + 2;
  const out = [`${"hook".padEnd(hookWidth)}calls  blocks  p50 ms  p95 ms`];
  for (const [hook, calls] of [...byHook].sort(([a], [b]) => a.localeCompare(b))) {
    const ms = calls.map((c) => c.ms).sort((a, b) => a - b);
    const blocks = calls.filter((c) => c.decision === "block").length;
    out.push(
      `${hook.padEnd(hookWidth)}${String(calls.length).padStart(5)}${String(blocks).padStart(8)}${String(percentile(ms, 0.5)).padStart(8)}${String(percentile(ms, 0.95)).padStart(8)}`,
    );
  }
  return out;
}

/** A blank line, the title and one row per rule; nothing when no rule has a count. */
function ruleSection(title: string, counts: Map<string, number>): string[] {
  if (counts.size === 0) return [];
  const ruleWidth = Math.max(...[...counts.keys()].map((r) => r.length)) + 2;
  const rows = [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rule, n]) => `  ${rule.padEnd(ruleWidth)}${n}`);
  return ["", title, ...rows];
}

/** #741: each push-wait override with its time, the cancelled run's age and its reason. */
function overrideLines(entries: HookLogEntry[]): string[] {
  const overrides = entries.filter(
    (e) => e.rule === "push-wait" && e.decision === "waived" && e.detail,
  );
  if (overrides.length === 0) return [];
  return [
    "",
    "push-wait overrides:",
    ...overrides.map((e) => {
      const age = e.minutes === undefined ? "no run in progress" : `run ${e.minutes} min old`;
      const when = `${e.t.slice(0, 16).replace("T", " ")} UTC`;
      return `  ${when}  ${age.padEnd(20)}${printable(e.detail ?? "")}`;
    }),
  ];
}

/** #833: each hold of the slot past 20 minutes, with its time, its length and who held it. */
function longHoldLines(entries: HookLogEntry[]): string[] {
  const holds = entries.filter(
    (e) => e.hook === SLOT && e.rule === "long-hold" && e.minutes !== undefined,
  );
  if (holds.length === 0) return [];
  return [
    "",
    `long slot holds (over 20 min): ${holds.length}`,
    ...holds.map((e) => {
      const when = `${e.t.slice(0, 16).replace("T", " ")} UTC`;
      const length = `${e.minutes} min`;
      return `  ${when}  ${length.padEnd(8)}${printable(e.detail ?? "")}`;
    }),
  ];
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
      typeof e.t === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(e.t) &&
      printable(e.hook) === e.hook &&
      (e.rule === null || (typeof e.rule === "string" && printable(e.rule) === e.rule)) &&
      (e.detail === undefined || typeof e.detail === "string") &&
      (e.minutes === undefined || typeof e.minutes === "number") &&
      ["allow", "block", "waived"].includes(e.decision);
    return ok ? (e as HookLogEntry) : null;
  } catch {
    return null;
  }
}
