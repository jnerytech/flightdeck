import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isRepoWide, scansRealRepo, unmarkedRepoScans } from "../lib/repo-wide.ts";

// repo-wide (#1108): reads every tracked test file, so CI's quick job runs it on every PR.
const ROOT = resolve(import.meta.dir, "../..");

// Built by concatenation so this file's own fixtures are not read as its scan.
const LS = `"ls-${"files"}"`;
const MARK = `// repo-${"wide"}`;

describe("repo-wide (#1108)", () => {
  test("a test that runs git ls-files on the real root counts, with or without Bun's spawn", () => {
    for (const source of [
      `const t = spawnSync("git", [${LS}, "*.md"], { cwd: ROOT, encoding: "utf8" });`,
      `const t = Bun.spawnSync(["git", ${LS}, "apps"], {\n  cwd: ROOT,\n});`,
      `const t = Bun.spawnSync(["git", ${LS}]).stdout.toString();`,
    ]) {
      expect(`${source}: ${scansRealRepo(source)}`).toBe(`${source}: true`);
    }
  });

  test("a temp repo, a fixture or a faked git does not count", () => {
    for (const source of [
      `const t = spawnSync("git", [${LS}], { cwd: repo, encoding: "utf8" });`,
      `const t = Bun.spawnSync(["git", ${LS}], { cwd: dir });`,
      `if (args[0] === ${LS}) return "";`,
      `expect(git(repo, ${LS})).toBe("a");`,
      `const t = spawnSync("git", ["status"], { cwd: ROOT });`,
    ]) {
      expect(`${source}: ${scansRealRepo(source)}`).toBe(`${source}: false`);
    }
  });

  test("#1114 review: other spawns, a git wrapper and the root under another name count too", () => {
    const shell = `"git ls-${"files"} apps"`;
    for (const source of [
      `const t = execSync(${shell}, { encoding: "utf8" });`,
      `const t = execFileSync("git", [${LS}], { cwd: REPO_ROOT });`,
      `const t = Bun.spawn(["git", ${LS}], { cwd: process.cwd() });`,
      `const t = spawnSync("git", [${LS}], { cwd: resolve(import.meta.dir, "../..") });`,
      `const t = spawnSync("git", [${LS}], { cwd: root });`,
      `const t = git(ROOT, ${LS}, "*.md");`,
    ]) {
      expect(`${source}: ${scansRealRepo(source)}`).toBe(`${source}: true`);
    }
    for (const source of [
      `const t = execSync(${shell}, { cwd: tmp });`,
      `const t = git(repo, ${LS});`,
      `switch (args[0]) {\n  case ${LS}:\n    return "";\n}`,
      `const reply = args[0] === ${LS} ? "a" : null;`,
    ]) {
      expect(`${source}: ${scansRealRepo(source)}`).toBe(`${source}: false`);
    }
  });

  test("the marker is a comment line of its own, starting // repo-wide", () => {
    expect(isRepoWide(`import x from "y";\n${MARK} (#1108): reads every doc\n`)).toBe(true);
    expect(isRepoWide(`  ${MARK}: scans the code\n`)).toBe(true);
    expect(isRepoWide(`const a = "${MARK}";\n`)).toBe(false);
    expect(isRepoWide(`// repo-widely used\n`)).toBe(false);
    expect(isRepoWide("")).toBe(false);
  });

  test("an unmarked scan of the real root is listed by path; a marked one or a temp repo is not", () => {
    const scan = `const t = spawnSync("git", [${LS}], { cwd: ROOT });`;
    expect(
      unmarkedRepoScans([
        { path: "scripts/test/a.test.ts", content: scan },
        { path: "scripts/test/b.test.ts", content: `${MARK}: x\n${scan}` },
        { path: "scripts/test/c.test.ts", content: scan.replace("ROOT", "repo") },
      ]),
    ).toEqual([
      "scripts/test/a.test.ts: runs git ls-files on the repository root with no // repo-wide comment line, so CI's quick job would not run it on every PR (#1108)",
    ]);
  });

  test("every test file of the repository that scans the real root carries the marker", () => {
    const tests = spawnSync("git", ["ls-files", "*.test.ts", "*.test.tsx"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .stdout.split("\n")
      .filter(Boolean);
    const files = tests.map((path) => ({ path, content: readFileSync(join(ROOT, path), "utf8") }));
    expect(unmarkedRepoScans(files)).toEqual([]);
    // The check reads real files: today eight or more tests scan the root.
    expect(files.filter((f) => scansRealRepo(f.content)).length).toBeGreaterThanOrEqual(8);
  });
});
