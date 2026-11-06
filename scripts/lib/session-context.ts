/**
 * What the SessionStart hook (.claude/hooks/session-start.ts) tells a session when it starts,
 * resumes or compacts (issue #169, D5): where it is, its TDD state and the slot. After a compact
 * the path-scoped rules are gone until a matching file is touched again, so it says so.
 */
import { describeHolder, parseHolder, type SlotHolder } from "./slot.ts";
import { auditBase, parseCommits } from "./tdd-audit.ts";

export interface SessionFacts {
  /** The checked-out branch, or null when detached. */
  branch: string | null;
  /** Commits since the audit base, or null when there is no base. */
  ahead: number | null;
  /** The scopes with a test(<scope>) commit since the base, in order. */
  tested: string[];
  /** Who holds the slot, or null when it is free. */
  slot: SlotHolder | null;
  now: number;
}

/** The facts, from git (run in the session's directory) and the slot's lock file. */
export function gatherFacts(
  git: (args: string[]) => string | null,
  slotLock: string | null,
  now: number,
): SessionFacts {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"])?.trim() || null;
  const base = auditBase(git);
  const count = base ? git(["rev-list", "--count", `${base}..HEAD`])?.trim() : undefined;
  const log = base ? (git(["log", "--format=%H%x1f%s", `${base}..HEAD`]) ?? "") : "";
  const tested: string[] = [];
  for (const c of parseCommits(log)) {
    if (c.type === "test" && c.scope && !tested.includes(c.scope)) tested.push(c.scope);
  }
  return {
    branch: branch === "HEAD" ? null : branch,
    ahead: count ? Number(count) : null,
    tested,
    slot: parseHolder(slotLock),
    now,
  };
}

/** The text the hook adds to the session's context for this source (startup, resume, compact). */
export function sessionContext(source: string, facts: SessionFacts): string {
  if (facts.branch === null) return "";
  const lines = [`Flightdeck session (${source}):`];
  if (facts.branch === "main") {
    lines.push(
      "- the main checkout, on main: dev work goes in its own worktree (cd ../flightdeck-<topic> && claude, or /cd there), where its rules and hooks load.",
    );
  } else {
    lines.push(`- branch ${facts.branch}, ${facts.ahead ?? "?"} commit(s) past main.`);
    lines.push(
      `- test(scope) commits so far: ${facts.tested.join(", ") || "none"}; a feat(x)/fix(x) needs its own test(x) first.`,
    );
  }
  lines.push(
    `- slot: ${facts.slot ? describeHolder(facts.slot, facts.now) : "free"}; heavy runs go through bun run slot --.`,
  );
  if (source === "compact") {
    lines.push(
      "- after this compact, the path rules in .claude/rules are back only once you touch a matching file: before editing, read the rule for that area (ui, protocol, daemon, tests, scripts).",
    );
  }
  return lines.join("\n");
}
