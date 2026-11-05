import { describe, expect, test } from "bun:test";
import {
  addedLines,
  type BranchCommit,
  parseBranchLog,
  riskyFiles,
  securityProblem,
  securityVerdict,
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

  test("more ways to start a process count as a spawn; a comment that names a secret does not (#273)", () => {
    const lines = (path: string, ...added: string[]) => [path, added] as [string, string[]];
    const added = new Map([
      lines("apps/daemon/src/a.ts", "cp.exec(command);"),
      lines("apps/daemon/src/b.ts", "await Bun.$`git status`;"),
      lines("apps/daemon/src/c.ts", 'import { fork } from "node:child_process";'),
      lines("apps/daemon/src/d.ts", "const w = new Worker(url);"),
      lines("apps/daemon/src/e.mjs", "await execa('git', ['status']);"),
      lines("apps/daemon/src/f.ts", "// the token comes from the vault", "const x = re.exec(s);"),
    ]);
    expect(riskyFiles(added)).toEqual([
      { path: "apps/daemon/src/a.ts", why: ["spawn"] },
      { path: "apps/daemon/src/b.ts", why: ["spawn"] },
      { path: "apps/daemon/src/c.ts", why: ["spawn"] },
      { path: "apps/daemon/src/d.ts", why: ["spawn"] },
      { path: "apps/daemon/src/e.mjs", why: ["spawn"] },
    ]);
  });

  test("the Tauri capabilities and config, the workflows and a pure rename into the vault are risky by path (#273)", () => {
    const rename = [
      "diff --git a/apps/daemon/src/x.ts b/apps/daemon/src/vault/x.ts",
      "similarity index 100%",
      "rename from apps/daemon/src/x.ts",
      "rename to apps/daemon/src/vault/x.ts",
    ].join("\n");
    const added = addedLines(rename);
    added.set("apps/desktop/src-tauri/capabilities/default.json", ['"fs:allow-read"']);
    added.set("apps/desktop/src-tauri/tauri.conf.json", ['"csp": null']);
    added.set(".github/workflows/ci.yml", ["run: bun run test"]);
    added.set("docs/manual/en.md", ["the vault keeps tokens"]);
    expect(riskyFiles(added).map((r) => r.path)).toEqual([
      ".github/workflows/ci.yml",
      "apps/daemon/src/vault/x.ts",
      "apps/desktop/src-tauri/capabilities/default.json",
      "apps/desktop/src-tauri/tauri.conf.json",
    ]);
  });

  test("code after a comment on the same line counts; a comment alone does not (#273)", () => {
    const added = new Map([
      ["apps/daemon/src/a.ts", ["/* biome-ignore lint: x */ execSync(command);"]],
      ["apps/daemon/src/b.ts", ["*/ spawnSync(x);"]],
      [
        "apps/daemon/src/c.ts",
        ["/* spawn( in a comment */", " * spawn( in a doc line", "// rm(x)"],
      ],
    ]);
    expect(riskyFiles(added).map((r) => r.path)).toEqual([
      "apps/daemon/src/a.ts",
      "apps/daemon/src/b.ts",
    ]);
  });

  test("Rust and Python spawns, deletes and listeners count too (#273)", () => {
    const added = new Map([
      ["apps/desktop/src-tauri/src/run.rs", ['let out = Command::new("git").output()?;']],
      ["apps/desktop/src-tauri/src/clean.rs", ["std::fs::remove_dir_all(&dir)?;"]],
      ["apps/desktop/src-tauri/src/net.rs", ['let l = TcpListener::bind("0.0.0.0:80")?;']],
      ["tools/x.py", ["subprocess.run(['git'])", "shutil.rmtree(d)"]],
    ]);
    expect(riskyFiles(added)).toEqual([
      { path: "apps/desktop/src-tauri/src/clean.rs", why: ["delete"] },
      { path: "apps/desktop/src-tauri/src/net.rs", why: ["network"] },
      { path: "apps/desktop/src-tauri/src/run.rs", why: ["spawn"] },
      { path: "tools/x.py", why: ["spawn", "delete"] },
    ]);
  });

  test("a mode change, and the files that run code (scripts, build, settings, hooks), are risky with no line added (#273)", () => {
    const modeOnly = [
      "diff --git a/scripts/run.sh b/scripts/run.sh",
      "old mode 100644",
      "new mode 100755",
    ].join("\n");
    const added = addedLines(modeOnly);
    for (const path of [
      "package.json",
      "apps/desktop/package.json",
      "apps/desktop/src-tauri/Cargo.toml",
      "apps/desktop/src-tauri/build.rs",
      "bunfig.area.toml",
      ".claude/settings.json",
      ".claude/hooks/guard.ts",
    ]) {
      added.set(path, []);
    }
    expect(riskyFiles(added)).toEqual([
      { path: ".claude/hooks/guard.ts", why: ["runs code"] },
      { path: ".claude/settings.json", why: ["runs code"] },
      { path: "apps/desktop/package.json", why: ["runs code"] },
      { path: "apps/desktop/src-tauri/Cargo.toml", why: ["runs code"] },
      { path: "apps/desktop/src-tauri/build.rs", why: ["runs code"] },
      { path: "bunfig.area.toml", why: ["runs code"] },
      { path: "package.json", why: ["runs code"] },
      { path: "scripts/run.sh", why: ["permission"] },
    ]);
  });

  test("risky files that no commit of the log touches need a review all the same (#273)", () => {
    const risky = [{ path: "apps/daemon/src/run.ts", why: ["spawn"] }];
    expect(securityProblem(risky, [commit("c", ["docs/x.md"], "an old review")]) ?? "").toContain(
      "apps/daemon/src/run.ts (spawn)",
    );
  });
});

/** A fake git for the gate: each command's answer, by its subcommand. */
function fakeGit(answers: { diff?: string | null; log?: string | null; base?: string | null }) {
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
});
