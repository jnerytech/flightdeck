import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { commitViolation } from "../lib/claude-hooks.ts";

const CWD = "/repos/flightdeck";
const HEAD = "f".repeat(40);
const BASE = "b".repeat(40);

/**
 * A fake git for one checkout: HEAD on a branch whose merge-base with origin/main is BASE, with
 * these subjects since BASE. Calls from any other directory fail, so a test proves where the
 * commit was aimed.
 */
function repo(subjects: string[], dir = CWD) {
  const calls: string[] = [];
  const git = (args: string[], cwd: string) => {
    calls.push(`${cwd}: ${args.join(" ")}`);
    if (cwd !== dir) return null;
    const key = args.join(" ");
    if (key === "rev-parse HEAD") return `${HEAD}\n`;
    if (key === "merge-base HEAD origin/main") return `${BASE}\n`;
    if (key.startsWith("log ") && key.endsWith(`${BASE}..HEAD`)) {
      return subjects.map((s, i) => `${i}\x1f${s}`).join("\n");
    }
    return null;
  };
  return { git, calls };
}

const gate = (command: string, subjects: string[] = []) =>
  commitViolation(command, CWD, repo(subjects));

describe("hook-commit-gate", () => {
  test("a subject that is not type(scope): text is blocked", () => {
    for (const subject of ["wip", "feature(a): x", "Fix the thing", "feat(a):x"]) {
      const reason = gate(`git commit -m "${subject}"`) ?? "";
      expect(reason).toContain("is blocked");
      expect(reason).toContain("type(scope): text");
    }
  });

  test("conventional subjects without a TDD pair, merges and reverts pass", () => {
    for (const subject of [
      "docs: the manual",
      "chore(versao): 0.36.3",
      "refactor(slot): one lock",
      "test(a): the red case",
      "style: format",
      "Merge branch 'main' into fase-39",
      'Revert "feat(a): x"',
    ]) {
      expect(gate(`git commit -m '${subject}'`)).toBeNull();
    }
  });

  test("feat or fix without a scope is blocked", () => {
    expect(gate('git commit -m "feat: a thing"') ?? "").toContain("needs a scope");
    expect(gate('git commit -m "fix: a bug"') ?? "").toContain("needs a scope");
  });

  test("feat(x) or fix(x) passes after a test(x) since the merge-base, and is blocked without one", () => {
    expect(gate('git commit -m "feat(a): x"', ["test(a): red", "docs: y"])).toBeNull();
    expect(gate('git commit -m "fix(a): x"', ["test(a)!: red"])).toBeNull();
    const reason = gate('git commit -m "feat(a): x"', ["test(b): red", "feat(b): green"]) ?? "";
    expect(reason).toContain("feat(a) is blocked");
    expect(reason).toContain("test(a)");
    expect(reason).toContain(BASE);
    expect(reason).toContain("FLIGHTDECK_TDD_WAIVER");
  });

  test("a waiver named in the command lets the commit through", () => {
    expect(
      gate('FLIGHTDECK_TDD_WAIVER="fixed during the rc merge" git commit -m "fix(a): x"'),
    ).toBeNull();
  });

  test("the subject is read from -m, --message, a heredoc and -F -", () => {
    const blocked = [
      'git commit -m "wip"',
      "git commit -m wip",
      'git commit --message="wip"',
      'git commit --message "wip"',
      'git commit -q -m "wip" -m "body"',
      `git commit -m "$(cat <<'EOF'\nwip\n\nBody text.\nEOF\n)"`,
      "git commit -q -F - <<'EOF'\n\nwip\nEOF",
    ];
    for (const command of blocked) expect(gate(command) ?? "").toContain("is blocked");
    expect(
      gate(`git commit -m "$(cat <<'EOF'\nfeat(a): x\n\nBody.\nEOF\n)"`, ["test(a): red"]),
    ).toBeNull();
    expect(gate('git commit -m "fix(a): the \\"x\\" case"', ["test(a): red"])).toBeNull();
  });

  test("a commit with no readable message passes", () => {
    for (const command of [
      "git commit",
      "git commit --amend --no-edit",
      "git commit -F msg.txt",
      "git status --short",
      "git log --oneline -5",
    ]) {
      expect(gate(command)).toBeNull();
    }
  });

  test("the commit runs where the command points: cd, git -C, or the shell's directory", () => {
    const wt = join(CWD, "..", "flightdeck-fase39");
    // The worktree has no test(a): only a gate that asks git there sees it and blocks.
    expect(
      commitViolation(`cd ../flightdeck-fase39 && git commit -m "feat(a): x"`, CWD, repo([], wt)) ??
        "",
    ).toContain("feat(a) is blocked");
    expect(
      commitViolation(`git -C ${wt} commit -m "feat(a): x"`, CWD, repo([], wt)) ?? "",
    ).toContain("feat(a) is blocked");
    const elsewhere = repo([], wt);
    expect(commitViolation('git commit -m "feat(a): x"', CWD, elsewhere)).toBeNull();
    expect(elsewhere.calls.length).toBeGreaterThan(0);
    expect(elsewhere.calls.every((call) => call.startsWith(`${CWD}:`))).toBe(true);
  });

  test("git failing, no base or a quoted directory lets the commit through", () => {
    const broken = { git: () => null };
    expect(commitViolation('git commit -m "feat(a): x"', CWD, broken)).toBeNull();
    const noBase = {
      git: (args: string[]) => (args.join(" ") === "rev-parse HEAD" ? HEAD : null),
    };
    expect(commitViolation('git commit -m "feat(a): x"', CWD, noBase)).toBeNull();
    const quoted = repo([]);
    expect(commitViolation('cd "../my dir" && git commit -m "feat(a): x"', CWD, quoted)).toBeNull();
    expect(quoted.calls).toEqual([]);
  });

  test("a command that commits nothing never calls git", () => {
    const quiet = repo([]);
    expect(commitViolation("bun run test && git add a.ts", CWD, quiet)).toBeNull();
    expect(quiet.calls).toEqual([]);
  });
});
