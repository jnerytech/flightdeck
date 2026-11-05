import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
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
    for (const subject of ["wip", "feature(a): x (#1)", "Fix the thing", "feat(a):x"]) {
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
      'Revert "feat(a): x (#1)"',
    ]) {
      expect(gate(`git commit -m '${subject}'`)).toBeNull();
    }
  });

  test("feat or fix without a scope is blocked", () => {
    expect(gate('git commit -m "feat: a thing"') ?? "").toContain("needs a scope");
    expect(gate('git commit -m "fix: a bug"') ?? "").toContain("needs a scope");
  });

  test("feat(x) or fix(x) passes after a test(x) since the merge-base, and is blocked without one", () => {
    expect(gate('git commit -m "feat(a): x (#1)"', ["test(a): red", "docs: y"])).toBeNull();
    expect(gate('git commit -m "fix(a): x (#1)"', ["test(a)!: red"])).toBeNull();
    const reason =
      gate('git commit -m "feat(a): x (#1)"', ["test(b): red", "feat(b): green"]) ?? "";
    expect(reason).toContain("feat(a) is blocked");
    expect(reason).toContain("test(a)");
    expect(reason).toContain(BASE);
    expect(reason).toContain("TDD-Waiver:");
  });

  test("a TDD-Waiver trailer in the message lets the commit through", () => {
    for (const command of [
      'git commit -m "fix(a): x (#1)" -m "TDD-Waiver: fixed during the rc merge"',
      "git commit -F - <<'EOF'\nfix(a): x (#1)\n\nWhy.\n\nTDD-Waiver: fixed during the rc merge\nEOF",
      'git commit -m "fix(a): x (#1)" --trailer "TDD-Waiver: fixed during the rc merge"',
    ]) {
      expect(gate(command)).toBeNull();
    }
    for (const command of [
      'git commit -m "fix(a): x (#1)" -m "TDD-Waiver:"',
      'FLIGHTDECK_TDD_WAIVER="old prefix" git commit -m "fix(a): x (#1)"',
      'git commit -m "fix(a): TDD-Waiver: in the subject (#1)"',
    ]) {
      expect(gate(command) ?? "").toContain("fix(a) is blocked");
    }
  });

  test("feat or fix with no issue is blocked, and says the two ways to name one (#253)", () => {
    for (const command of [
      'git commit -m "feat(a): x"',
      'git commit -m "fix(a): handle #12 in the subject without parentheses"',
      'git commit -m "fix(a): x" -m "See #12 for the history."',
      'git commit -m "fix(a): x" -m "TDD-Waiver: the waiver is for the TDD order only"',
    ]) {
      const reason = gate(command, ["test(a): red"]) ?? "";
      expect(reason).toContain("needs an issue");
      expect(reason).toContain("(#N)");
      expect(reason).toContain("Refs: #N");
    }
  });

  test("an issue in the subject's parentheses or in a Refs/Closes/Fixes/Resolves line passes (#253)", () => {
    for (const command of [
      'git commit -m "feat(a): x (#12)"',
      'git commit -m "fix(a): x (#12, #13)"',
      'git commit -m "fix(a): x (review of rc/0364, #237)"',
      'git commit -m "feat(a): x" -m "Refs: #12"',
      "git commit -F - <<'EOF'\nfix(a): x\n\nWhy.\n\nCloses #12\nEOF",
      'git commit -m "fix(a): x" -m "Fixes #12"',
      'git commit -m "fix(a): x" --trailer "Refs: #12"',
    ]) {
      expect(gate(command, ["test(a): red"])).toBeNull();
    }
  });

  test("test, docs, chore(versao) and the other types need no issue (#253)", () => {
    for (const subject of ["test(a): red", "docs: x", "chore(versao): 0.36.5", "refactor(a): y"]) {
      expect(gate(`git commit -m "${subject}"`)).toBeNull();
    }
  });

  test("fixup! and squash! commits pass", () => {
    expect(gate('git commit -m "fixup! feat(a): x (#1)"')).toBeNull();
    expect(gate('git commit -m "squash! feat(a): x (#1)"')).toBeNull();
  });

  test("only the commit's own -m or heredoc is read, never another command's", () => {
    const appendThenCommit =
      "cat >> docs/DECISIONS.md <<'EOF'\n\n## Harness D1: the commit gate\n\n- a line\nEOF\ngit status --short && git add docs/DECISIONS.md && git commit -q -F - <<'EOF'\nfeat(a): x (#1)\n\nBody.\nEOF";
    expect(gate(appendThenCommit, ["test(a): red"])).toBeNull();
    expect(gate(appendThenCommit) ?? "").toContain("feat(a) is blocked");
    expect(
      gate('grep -m 1 x f.txt && git commit -m "feat(a): x (#1)"', ["test(a): red"]),
    ).toBeNull();
    expect(
      gate('python3 -m json.tool a.json; git commit -m "feat(a): x (#1)"', ["test(a): red"]),
    ).toBeNull();
  });

  test("a -m inside the message body is text, and quotes inside a heredoc body do not end it", () => {
    expect(
      gate("git commit -F - <<'EOF'\nfeat(a): x (#1)\n\nRun git log -m foo to see it.\nEOF") ?? "",
    ).toContain("feat(a) is blocked");
    expect(
      gate(`git commit -m "$(cat <<'EOF'\nfeat(a): x (#1)\n\nThe "quoted" word.\nEOF\n)"`) ?? "",
    ).toContain("feat(a) is blocked");
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
      gate(`git commit -m "$(cat <<'EOF'\nfeat(a): x (#1)\n\nBody.\nEOF\n)"`, ["test(a): red"]),
    ).toBeNull();
    expect(gate('git commit -m "fix(a): the \\"x\\" case (#1)"', ["test(a): red"])).toBeNull();
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
    const wt = resolve(CWD, "..", "flightdeck-fase39");
    // The worktree has no test(a): only a gate that asks git there sees it and blocks.
    expect(
      commitViolation(
        `cd ../flightdeck-fase39 && git commit -m "feat(a): x (#1)"`,
        CWD,
        repo([], wt),
      ) ?? "",
    ).toContain("feat(a) is blocked");
    expect(
      commitViolation(`git -C ${wt} commit -m "feat(a): x (#1)"`, CWD, repo([], wt)) ?? "",
    ).toContain("feat(a) is blocked");
    const elsewhere = repo([], wt);
    expect(commitViolation('git commit -m "feat(a): x (#1)"', CWD, elsewhere)).toBeNull();
    expect(elsewhere.calls.length).toBeGreaterThan(0);
    expect(elsewhere.calls.every((call) => call.startsWith(`${CWD}:`))).toBe(true);
  });

  test("git failing, no base or a quoted directory lets the commit through", () => {
    const broken = { git: () => null };
    expect(commitViolation('git commit -m "feat(a): x (#1)"', CWD, broken)).toBeNull();
    const noBase = {
      git: (args: string[]) => (args.join(" ") === "rev-parse HEAD" ? HEAD : null),
    };
    expect(commitViolation('git commit -m "feat(a): x (#1)"', CWD, noBase)).toBeNull();
    const quoted = repo([]);
    expect(
      commitViolation('cd "../my dir" && git commit -m "feat(a): x (#1)"', CWD, quoted),
    ).toBeNull();
    expect(quoted.calls).toEqual([]);
  });

  test("a commit in a repository that is not this project's is never checked", () => {
    // Resolved as the gate resolves it, so the case holds on Windows too.
    const foreign = { ...repo([]), inProject: (dir: string) => dir !== resolve("/tmp/poc") };
    expect(commitViolation('cd /tmp/poc && git commit -m "init"', CWD, foreign)).toBeNull();
    expect(commitViolation('git -C /tmp/poc commit -m "feat(a): x (#1)"', CWD, foreign)).toBeNull();
    expect(foreign.calls).toEqual([]);
    expect(commitViolation('git commit -m "init"', CWD, foreign) ?? "").toContain("is blocked");
  });

  test("a command that commits nothing never calls git", () => {
    const quiet = repo([]);
    expect(commitViolation("bun run test && git add a.ts", CWD, quiet)).toBeNull();
    expect(quiet.calls).toEqual([]);
  });
});
