import { describe, expect, test } from "bun:test";
import { addedLines, securityVerdict } from "../../lib/pr/security-gate.ts";

/** A fake git for the gate: each command's answer, by its subcommand. */
function fakeGit(answers: {
  diff?: string | null;
  log?: string | null;
  base?: string | null;
  show?: Record<string, string>;
}) {
  const calls: string[][] = [];
  const git = (args: string[]): string | null => {
    calls.push(args);
    const sub = args.find((a) => !a.startsWith("-") && !a.includes("=")) ?? "";
    if (sub === "rev-parse" && args.includes("--end-of-options")) {
      return answers.base === undefined ? "base0\n" : answers.base;
    }
    if (sub === "rev-parse") return "head0\n";
    if (sub === "symbolic-ref") return "feature\n";
    if (sub === "merge-base") return "base0\n";
    if (sub === "diff") return answers.diff === undefined ? "" : answers.diff;
    if (sub === "log") return answers.log === undefined ? "" : answers.log;
    if (sub === "show") return answers.show?.[(args.at(-1) ?? "").replace(/^HEAD:/, "")] ?? null;
    return null;
  };
  return { git, calls };
}

const RISKY_DIFF = [
  "diff --git a/apps/daemon/src/run.ts b/apps/daemon/src/run.ts",
  "+++ b/apps/daemon/src/run.ts",
  "@@ -1 +1 @@",
  '+Bun.spawn(["git"]);',
].join("\n");

describe("security-gate: end to end", () => {
  test("a git that fails, or a base that does not resolve, gives unknown, never 0 (#273)", () => {
    for (const [answers, base, why] of [
      [{ diff: null }, undefined, "git diff failed"],
      [{ diff: RISKY_DIFF, log: null }, undefined, "git log failed"],
      [{ base: null }, "-x", "-x is not a commit"],
    ] as const) {
      const verdict = securityVerdict(fakeGit(answers).git, base);
      expect(verdict.verdict).toBe("unknown");
      expect(verdict.message ?? "").toContain(why);
    }
  });

  test("the diff forces its own prefixes and no external diff; the log is in topological order with unfolded trailers (#273)", () => {
    const { git, calls } = fakeGit({ diff: "" });
    expect(securityVerdict(git).verdict).toBe("0");
    const diff = calls.find((c) => c.includes("diff")) ?? [];
    for (const flag of ["--src-prefix=a/", "--dst-prefix=b/", "--no-ext-diff", "--no-textconv"]) {
      expect(diff).toContain(flag);
    }
    expect(diff.at(-1)).toBe("base0...HEAD");
    const log = calls.find((c) => c.includes("log")) ?? [];
    expect(log).toContain("--topo-order");
    expect(log).toContain("--no-show-signature");
    expect(log.join(" ")).toContain("unfold");
    expect(log.at(-1)).toBe("base0..HEAD");
  });

  test("--base is resolved first, and only the commit it names reaches the diff (#273)", () => {
    const { git, calls } = fakeGit({ base: "abc123\n", diff: "" });
    securityVerdict(git, "origin/ci-paths");
    expect(calls[0]).toEqual([
      "rev-parse",
      "--verify",
      "--end-of-options",
      "origin/ci-paths^{commit}",
    ]);
    expect((calls.find((c) => c.includes("diff")) ?? []).at(-1)).toBe("abc123...HEAD");
  });

  test("a risky diff is unreviewed until a trailer comes after it (#273)", () => {
    const log = (trailer: string) => `\x1ea1\x1f${trailer}\n\napps/daemon/src/run.ts\n`;
    const unreviewed = securityVerdict(fakeGit({ diff: RISKY_DIFF, log: log("") }).git);
    expect(unreviewed.verdict).toBe("unreviewed");
    expect(unreviewed.message ?? "").toContain("apps/daemon/src/run.ts (spawn)");
    const reviewed = securityVerdict(fakeGit({ diff: RISKY_DIFF, log: log("no finding") }).git);
    expect(reviewed).toEqual({ verdict: "0", message: null });
  });

  test("a removed check in a file whose code still spawns makes the verdict unreviewed (#284)", () => {
    const diff = [
      "diff --git a/apps/daemon/src/run.ts b/apps/daemon/src/run.ts",
      "+++ b/apps/daemon/src/run.ts",
      "@@ -3 +2,0 @@",
      '-if (!allowed(path)) throw new Error("refused");',
    ].join("\n");
    const log = "\x1ea1\x1f\n\napps/daemon/src/run.ts\n";
    const show = { "apps/daemon/src/run.ts": 'const p = Bun.spawn(["git", path]);' };
    const { git, calls } = fakeGit({ diff, log, show });
    const verdict = securityVerdict(git);
    expect(verdict.verdict).toBe("unreviewed");
    expect(verdict.message ?? "").toContain("apps/daemon/src/run.ts (edits spawn code)");
    expect(calls.find((c) => c.includes("show"))).toEqual(["show", "HEAD:apps/daemon/src/run.ts"]);
  });

  test("risky files found by their added lines and by an edit are listed together, by path (#284)", () => {
    const diff = [
      "diff --git a/apps/daemon/src/z.ts b/apps/daemon/src/z.ts",
      "+++ b/apps/daemon/src/z.ts",
      "@@ -1 +1 @@",
      '+Bun.spawn(["git"]);',
      "diff --git a/apps/daemon/src/a.ts b/apps/daemon/src/a.ts",
      "+++ b/apps/daemon/src/a.ts",
      "@@ -2 +1,0 @@",
      "-if (!ok) return;",
    ].join("\n");
    const show = { "apps/daemon/src/a.ts": "rmSync(dir);" };
    const verdict = securityVerdict(fakeGit({ diff, log: "", show }).git);
    const message = verdict.message ?? "";
    expect(message).toContain("apps/daemon/src/a.ts (edits delete code)");
    expect(message).toContain("apps/daemon/src/z.ts (spawn)");
    expect(message.indexOf("apps/daemon/src/a.ts (edits delete code)")).toBeLessThan(
      message.indexOf("apps/daemon/src/z.ts (spawn)"),
    );
  });

  test("a deleted file is not read at HEAD, so only its removed lines count (#284)", () => {
    const diff = [
      "diff --git a/apps/daemon/src/gone.ts b/apps/daemon/src/gone.ts",
      "deleted file mode 100644",
      "--- a/apps/daemon/src/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-export const x = 1;",
    ].join("\n");
    const { git, calls } = fakeGit({ diff, log: "" });
    expect(securityVerdict(git)).toEqual({ verdict: "0", message: null });
    expect(calls.some((c) => c.includes("show"))).toBe(false);
  });

  test("a rename away from a risky path, reviewed after, vouches: the log lists both paths (#284)", () => {
    const diff = [
      "diff --git a/.github/workflows/ci.yml b/docs/ci.yml",
      "similarity index 100%",
      "rename from .github/workflows/ci.yml",
      "rename to docs/ci.yml",
    ].join("\n");
    const log = [
      "\x1er2\x1fno finding\n\n",
      "\x1er1\x1f\n\n.github/workflows/ci.yml\ndocs/ci.yml\n",
    ].join("");
    const { git, calls } = fakeGit({ diff, log });
    expect(securityVerdict(git)).toEqual({ verdict: "0", message: null });
    expect(calls.find((c) => c.includes("log"))).toContain("--no-renames");
  });

  test("a file renamed into a test folder still counts the checks it lost, read from its new path (#284)", () => {
    const diff = [
      "diff --git a/apps/daemon/src/run.ts b/apps/daemon/test/run.ts",
      "similarity index 90%",
      "rename from apps/daemon/src/run.ts",
      "rename to apps/daemon/test/run.ts",
      "--- a/apps/daemon/src/run.ts",
      "+++ b/apps/daemon/test/run.ts",
      "@@ -3 +2,0 @@",
      '-if (!allowed(path)) throw new Error("refused");',
    ].join("\n");
    const log = "\x1ea1\x1f\n\napps/daemon/src/run.ts\napps/daemon/test/run.ts\n";
    const show = { "apps/daemon/test/run.ts": 'Bun.spawn(["git", path]);' };
    const { git, calls } = fakeGit({ diff, log, show });
    const verdict = securityVerdict(git);
    expect(verdict.message ?? "").toContain("apps/daemon/src/run.ts (edits spawn code)");
    expect(calls.find((c) => c.includes("show"))).toEqual(["show", "HEAD:apps/daemon/test/run.ts"]);
  });

  test("a file name git quotes makes the gate unknown, never 0 (#284)", () => {
    const diff = [
      'diff --git "a/apps/daemon/src/q\\"x.ts" "b/apps/daemon/src/q\\"x.ts"',
      '+++ "b/apps/daemon/src/q\\"x.ts"',
      "@@ -1 +1 @@",
      '+Bun.spawn(["git"]);',
    ].join("\n");
    const verdict = securityVerdict(fakeGit({ diff, log: "" }).git);
    expect(verdict.verdict).toBe("unknown");
    expect(verdict.message ?? "").toContain("a file name git quotes");
  });

  test("a removal of comments or blank lines only does not read HEAD (#284)", () => {
    const diff = [
      "diff --git a/apps/daemon/src/run.ts b/apps/daemon/src/run.ts",
      "+++ b/apps/daemon/src/run.ts",
      "@@ -3,2 +2,0 @@",
      "-// an old note",
      "-",
    ].join("\n");
    const { git, calls } = fakeGit({
      diff,
      log: "",
      show: { "apps/daemon/src/run.ts": "spawn(x);" },
    });
    expect(securityVerdict(git)).toEqual({ verdict: "0", message: null });
    expect(calls.some((c) => c.includes("show"))).toBe(false);
  });

  test('a mode change or a deletion in a folder named with " b/" keeps its exact path (#284)', () => {
    const diff = [
      "diff --git a/.claude/hooks b/x.ts b/.claude/hooks b/x.ts",
      "old mode 100644",
      "new mode 100755",
      "diff --git a/scripts/lib/a b/claude-hooks.ts b/scripts/lib/a b/claude-hooks.ts",
      "deleted file mode 100644",
      "--- a/scripts/lib/a b/claude-hooks.ts",
      "+++ /dev/null",
    ].join("\n");
    expect([...addedLines(diff).keys()].sort()).toEqual([
      ".claude/hooks b/x.ts",
      "scripts/lib/a b/claude-hooks.ts",
    ]);
  });

  test('removing a lone "/*" un-comments the code after it, so the file\'s code is read (#284)', () => {
    const diff = [
      "diff --git a/apps/daemon/src/run.ts b/apps/daemon/src/run.ts",
      "--- a/apps/daemon/src/run.ts",
      "+++ b/apps/daemon/src/run.ts",
      "@@ -3 +2,0 @@",
      "-/*",
    ].join("\n");
    const show = { "apps/daemon/src/run.ts": 'Bun.spawn(["git"]);\n*/' };
    const verdict = securityVerdict(fakeGit({ diff, log: "", show }).git);
    expect(verdict.message ?? "").toContain("apps/daemon/src/run.ts (edits spawn code)");
  });

  test("a file moved from a test folder into the code is risky, even with no line changed (#284)", () => {
    const diff = [
      "diff --git a/apps/daemon/test/helper.ts b/apps/daemon/src/helper.ts",
      "similarity index 100%",
      "rename from apps/daemon/test/helper.ts",
      "rename to apps/daemon/src/helper.ts",
    ].join("\n");
    const verdict = securityVerdict(fakeGit({ diff, log: "" }).git);
    expect(verdict.message ?? "").toContain("apps/daemon/src/helper.ts (moved from tests)");
  });

  test("a file moved from tests that its added lines already make risky is listed once (#284)", () => {
    const diff = [
      "diff --git a/apps/daemon/test/helper.ts b/apps/daemon/src/helper.ts",
      "similarity index 90%",
      "rename from apps/daemon/test/helper.ts",
      "rename to apps/daemon/src/helper.ts",
      "--- a/apps/daemon/test/helper.ts",
      "+++ b/apps/daemon/src/helper.ts",
      "@@ -1,0 +2 @@",
      '+Bun.spawn(["git"]);',
    ].join("\n");
    const message = securityVerdict(fakeGit({ diff, log: "" }).git).message ?? "";
    expect(message).toContain("1 risky file(s)");
    expect(message).toContain("apps/daemon/src/helper.ts (spawn)");
  });
});
