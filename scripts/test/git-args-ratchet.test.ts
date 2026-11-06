import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { unguardedGitCalls, unguardedInTree } from "../lib/git-args.ts";
import { realTempDir } from "./temp-dir.ts";

const ROOT = resolve(import.meta.dir, "../..");
const calls = (source: string) => unguardedGitCalls(source, "x.ts").map((f) => f.call);

describe("git-args-ratchet: no git call gives a base or a branch to git unguarded (issue #345)", () => {
  test("a bare base, a base at the start of a revision and a project's base are flagged", () => {
    expect(calls('await git(repo, "rebase", "--autostash", base);')).toHaveLength(1);
    expect(calls("await git(repo, 'show', `${base}:${path}`);")).toHaveLength(1);
    expect(
      calls('await git(project.path, "ls-tree", project.baseBranch, "--", FILE);'),
    ).toHaveLength(1);
    expect(calls('await git(cwd, "merge", "--no-ff", "-m", message, branch);')).toHaveLength(1);
    expect(calls('await gitLimited(cwd, 1000, "diff", source);')).toHaveLength(1);
  });

  test("a call that spans lines is read whole, and its line is the line of the call", () => {
    const found = unguardedGitCalls(
      ["const a = 1;", "await git(", "  repo,", '  "rebase",', "  base,", ");"].join("\n"),
      "m.ts",
    );
    expect(found).toEqual([{ file: "m.ts", line: 2, call: expect.stringContaining("rebase") }]);
  });

  test("a guarded value, a prefixed one, a literal and what follows an end of options are fine", () => {
    expect(calls('await git(repo, "rebase", refArg(base));')).toEqual([]);
    expect(calls("await git(repo, 'show', `${refArg(base)}:${path}`);")).toEqual([]);
    expect(calls("await git(repo, 'show-ref', `refs/heads/${base}`);")).toEqual([]);
    expect(calls("await git(root, 'rev-list', `origin/${branch}..HEAD`);")).toEqual([]);
    expect(calls('await git(repo, "rebase", "main");')).toEqual([]);
    expect(calls('await git(repo, "diff", "--end-of-options", base);')).toEqual([]);
    expect(calls('await git(repo, "restore", "--", branch);')).toEqual([]);
  });

  test("a reviewed call says why on the line above or on its own line, and a comment alone is not a call", () => {
    expect(
      calls(
        '// git-arg: the name is made here and starts with fd/\nawait git(repo, "branch", "-D", branch);',
      ),
    ).toEqual([]);
    expect(
      calls('await git(repo, "branch", "-D", branch); // git-arg: made here, starts with fd/'),
    ).toEqual([]);
    expect(calls('// await git(repo, "rebase", base);\nconst x = 1;')).toEqual([]);
    expect(calls('const s = "git(repo, base)";')).toEqual([]);
  });

  test("a method call and strings with parentheses inside the arguments do not confuse it", () => {
    expect(
      calls('await this.git(worktree, "rev-list", "--count", `origin/${branch}..HEAD`);'),
    ).toEqual([]);
    expect(calls('await this.git(worktree, "rebase", base);')).toHaveLength(1);
    expect(calls('await git(repo, "log", "--format=%s (%h)", ref);')).toHaveLength(1);
  });

  test("a base under another name, in a ternary, a cast or a concatenation is flagged too", () => {
    for (const arg of [
      "targetBranch",
      "baseRef",
      "against",
      "startPoint",
      "upstream",
      "ok ? base : main",
      "(base as string)",
      "base + suffix",
      "x ?? base",
    ]) {
      expect(calls(`await git(repo, "rebase", ${arg});`)).toHaveLength(1);
    }
    expect(calls('await git(repo, "rebase", "origin/" + base);')).toEqual([]);
  });

  test("an array of arguments is read element by element, and a spread of something not constant is flagged", () => {
    expect(calls('await git(cwd, ["rebase", base]);')).toHaveLength(1);
    expect(calls('await git(cwd, ["update-ref", "-d", row.ref]);')).toHaveLength(1);
    expect(calls('await git(cwd, ["rebase", refArg(base)]);')).toEqual([]);
    expect(calls("await git(repo, ...args);")).toHaveLength(1);
    expect(calls("await git(repo, ...baseArgs);")).toHaveLength(1);
    expect(calls('await git(repo, ...RAW_PATHS, "diff");')).toEqual([]);
  });

  test("a url or a glob inside a template, or a parenthesis inside a string, does not hide the call after it", () => {
    expect(calls('const u = `https://x/${a}`; await git(r, "rebase", base);')).toHaveLength(1);
    expect(
      calls('const g = `src/*`;\nawait git(r, "rebase", base);\nconst h = `*/`;'),
    ).toHaveLength(1);
    expect(calls('await git(r, "log", "--grep=)", base);')).toHaveLength(1);
    expect(calls('await git(r, "log", "--grep=(", base);')).toHaveLength(1);
  });

  test("braces inside a template's interpolation do not end it early, and an unterminated one is an error", () => {
    expect(calls('await git(r, "show", `${({ a: base }).a}:file`);')).toHaveLength(1);
    expect(calls('await git(r, "show", `${({ a: "main" }).a}:file`);')).toEqual([]);
    expect(() => calls('await git(r, "show", `${base`);')).toThrow("cannot read");
  });

  test("a comma or a name inside a string is not an argument", () => {
    expect(calls('await git(r, "log", "--format=a, base");')).toEqual([]);
    expect(calls('await git(r, "log", "--author=branch");')).toEqual([]);
  });

  test("a call it cannot read is an error, not a pass", () => {
    expect(() => unguardedGitCalls('await git(repo, "rebase", base', "broken.ts")).toThrow(
      "broken.ts:1",
    );
  });

  test("the daemon's sources hold no unguarded call", () => {
    expect(
      unguardedInTree(join(ROOT, "apps/daemon/src")).map((f) => `${f.file}:${f.line}`),
    ).toEqual([]);
  });

  test("a tree with a bad call is reported with the file and the line", () => {
    const root = realTempDir("fd-git-args-");
    const put = (path: string, text: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    put("a/ok.ts", 'await git(repo, "rebase", refArg(base));\n');
    put("a/bad.ts", '\nawait git(repo, "rebase", base);\n');
    put("a/node_modules/x/bad.ts", 'await git(repo, "rebase", base);\n');
    expect(unguardedInTree(root).map((f) => `${f.file}:${f.line}`)).toEqual(["a/bad.ts:2"]);
  });
});
