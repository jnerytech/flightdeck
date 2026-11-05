import { describe, expect, test } from "bun:test";
import {
  addedLines,
  type BranchCommit,
  parseBranchLog,
  riskyFiles,
  securityProblem,
} from "../lib/security-gate.ts";

const DIFF = [
  "diff --git a/apps/daemon/src/run.ts b/apps/daemon/src/run.ts",
  "--- a/apps/daemon/src/run.ts",
  "+++ b/apps/daemon/src/run.ts",
  "@@ -1,0 +2,2 @@",
  '+const proc = Bun.spawn(["git", "status"]);',
  "+proc.kill();",
  "diff --git a/scripts/lib/clean.ts b/scripts/lib/clean.ts",
  "--- a/scripts/lib/clean.ts",
  "+++ b/scripts/lib/clean.ts",
  "@@ -3 +3 @@",
  '-const keep = "x";',
  "+rmSync(dir, { recursive: true });",
  "diff --git a/apps/daemon/src/vault/store.ts b/apps/daemon/src/vault/store.ts",
  "+++ b/apps/daemon/src/vault/store.ts",
  "@@ -1 +1 @@",
  "+export const n = 1;",
  "diff --git a/apps/daemon/src/log.ts b/apps/daemon/src/log.ts",
  "+++ b/apps/daemon/src/log.ts",
  "@@ -1 +1 @@",
  "+log(`token ${value}`);",
  "+chmodSync(path, 0o600);",
  "diff --git a/apps/daemon/test/run.test.ts b/apps/daemon/test/run.test.ts",
  "+++ b/apps/daemon/test/run.test.ts",
  "@@ -1 +1 @@",
  '+Bun.spawn(["x"]);',
  "diff --git a/scripts/pr-flow.ts b/scripts/pr-flow.ts",
  "+++ b/scripts/pr-flow.ts",
  "@@ -1 +1 @@",
  "+run: (cmd) => spawnExec(cmd),",
  "diff --git a/apps/desktop/src/ui/confirm.ts b/apps/desktop/src/ui/confirm.ts",
  "+++ b/apps/desktop/src/ui/confirm.ts",
  "@@ -1 +1 @@",
  "+confirm(form); perform(rmArgs);",
  "diff --git a/docs/manual/en.md b/docs/manual/en.md",
  "+++ b/docs/manual/en.md",
  "@@ -1 +1 @@",
  "+Run spawn( to start.",
  // An added line "++ b/notes.md" reads as a header; it must not hide the lines after it.
  "diff --git a/apps/daemon/src/spoof.ts b/apps/daemon/src/spoof.ts",
  "--- a/apps/daemon/src/spoof.ts",
  "+++ b/apps/daemon/src/spoof.ts",
  "@@ -1,0 +1,2 @@",
  "+++ b/notes.md",
  '+Bun.spawn(["x"]);',
  // git ends a name with a space with a tab in the header.
  "diff --git a/apps/daemon/src/a b.ts b/apps/daemon/src/a b.ts",
  "+++ b/apps/daemon/src/a b.ts\t",
  "@@ -1 +1 @@",
  "+await rm(dir);",
  "diff --git a/apps/daemon/src/e2e/net.ts b/apps/daemon/src/e2e/net.ts",
  "+++ b/apps/daemon/src/e2e/net.ts",
  "@@ -1 +1 @@",
  "+const server = Bun.serve({ fetch });",
  "diff --git a/scripts/test/helper.ts b/scripts/test/helper.ts",
  "+++ b/scripts/test/helper.ts",
  "@@ -1 +1 @@",
  "+await fetch(url);",
  "diff --git a/apps/daemon/src/gone.ts b/apps/daemon/src/gone.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  '-Bun.spawn(["x"]);',
].join("\n");

const commit = (sha: string, files: string[], reviewed: string | null = null): BranchCommit => ({
  sha,
  files,
  reviewed,
});

describe("security-gate", () => {
  test("the added lines of each file come from a zero-context diff; a deleted file adds none (#273)", () => {
    const added = addedLines(DIFF);
    expect(added.get("apps/daemon/src/run.ts")).toEqual([
      'const proc = Bun.spawn(["git", "status"]);',
      "proc.kill();",
    ]);
    expect(added.get("scripts/lib/clean.ts")).toEqual(["rmSync(dir, { recursive: true });"]);
    expect(added.has("apps/daemon/src/gone.ts")).toBe(false);
    expect(added.has("notes.md")).toBe(false);
    expect(added.get("apps/daemon/src/spoof.ts")).toEqual(["++ b/notes.md", 'Bun.spawn(["x"]);']);
    expect(added.get("apps/daemon/src/a b.ts")).toEqual(["await rm(dir);"]);
  });

  test("spawn or kill, a delete, a secret, a permission, the vault or pairing make a source file risky; tests, docs and look-alike words do not (#273)", () => {
    expect(riskyFiles(addedLines(DIFF))).toEqual([
      { path: "apps/daemon/src/a b.ts", why: ["delete"] },
      { path: "apps/daemon/src/e2e/net.ts", why: ["network"] },
      { path: "apps/daemon/src/log.ts", why: ["secret", "permission"] },
      { path: "apps/daemon/src/run.ts", why: ["spawn"] },
      { path: "apps/daemon/src/spoof.ts", why: ["spawn"] },
      { path: "apps/daemon/src/vault/store.ts", why: ["vault or pairing"] },
      { path: "scripts/lib/clean.ts", why: ["delete"] },
      { path: "scripts/pr-flow.ts", why: ["spawn"] },
    ]);
  });

  test("the branch log gives each commit's files and its Security-Reviewed trailer (#273)", () => {
    const log = [
      "\x1eaaa\x1fno high or medium finding in the spawn path\n",
      "",
      "apps/daemon/src/run.ts",
      "\x1ebbb\x1f\n",
      "",
      "apps/daemon/src/log.ts",
      "docs/x.md",
      "",
    ].join("\n");
    expect(parseBranchLog(log)).toEqual([
      commit("aaa", ["apps/daemon/src/run.ts"], "no high or medium finding in the spawn path"),
      commit("bbb", ["apps/daemon/src/log.ts", "docs/x.md"]),
    ]);
  });

  test("no risky file needs no review (#273)", () => {
    expect(securityProblem([], [commit("a", ["docs/x.md"])])).toBeNull();
  });

  test("a risky change needs a review committed at or after its last risky commit (#273)", () => {
    const risky = [{ path: "apps/daemon/src/run.ts", why: ["spawn"] }];
    const unreviewed = securityProblem(risky, [commit("b", ["apps/daemon/src/run.ts"])]) ?? "";
    expect(unreviewed).toContain("apps/daemon/src/run.ts (spawn)");
    expect(unreviewed).toContain("security-reviewer");
    expect(unreviewed).toContain("Security-Reviewed:");
    // Reviewed in a later commit, or in the risky commit itself: it vouches.
    expect(
      securityProblem(risky, [
        commit("c", [], "no finding"),
        commit("b", ["apps/daemon/src/run.ts"]),
      ]),
    ).toBeNull();
    expect(securityProblem(risky, [commit("b", ["apps/daemon/src/run.ts"], "ok")])).toBeNull();
    // A review that a later risky commit came after vouches for nothing.
    expect(
      securityProblem(risky, [
        commit("d", ["apps/daemon/src/run.ts"]),
        commit("c", [], "no finding"),
        commit("b", ["apps/daemon/src/run.ts"]),
      ]),
    ).toContain("apps/daemon/src/run.ts (spawn)");
  });
});
