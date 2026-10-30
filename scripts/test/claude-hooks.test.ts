import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkoutRoot, commandViolation, generatedViolation } from "../lib/claude-hooks.ts";
import { realTempDir } from "./temp-dir.ts";

describe("claude-hooks", () => {
  test("staging everything at once is blocked, with or without options before add", () => {
    for (const command of [
      "git add -A",
      "git add .",
      "git add --all",
      "git add -u",
      "git add --update",
      "git add -vA",
      "git -C ../flightdeck-fase11 add -A",
      "git -c core.autocrlf=false add .",
      "cd ../flightdeck-fase11 && git add -A && git commit -m wip",
    ]) {
      expect(commandViolation(command) ?? "").toContain("is blocked");
    }
  });

  test("staging explicit paths passes", () => {
    for (const command of [
      "git add apps/daemon/src/x.ts",
      "git add -- ./scripts/lib/a.ts docs/TDD.md",
      "git -C ../flightdeck-fase11 add apps/desktop/src/ui/Board.tsx",
      "git status --short && git add .gitignore",
    ]) {
      expect(commandViolation(command)).toBeNull();
    }
  });

  test("commit -a is blocked wherever the flag sits", () => {
    for (const command of [
      "git commit -a -m wip",
      "git commit -am wip",
      'git commit -m "wip" -a',
      "git commit --all -m wip",
      "git -C ../x commit -am wip",
    ]) {
      expect(commandViolation(command) ?? "").toContain("is blocked");
    }
  });

  test("text inside quotes or a heredoc is not a command", () => {
    for (const command of [
      'git commit -m "docs: never use git add . here"',
      "git commit -m 'git add -A is blocked'",
      'echo "git add -A" > notes.txt',
      "git commit -F - <<'EOF'\nchore: explain that git add -A and git commit -a are blocked\nEOF",
      'git commit -m "feat(a): x -a y"',
    ]) {
      expect(commandViolation(command)).toBeNull();
    }
  });

  test("generated files are blocked by path relative to their checkout", () => {
    for (const rel of [
      "bun.lock",
      "coverage/lcov.info",
      "dist/flightdeckd-linux-x64",
      "node_modules/x/index.js",
      "apps/desktop/src-tauri/target/debug/x",
      "apps/desktop/src-tauri/gen/schemas/x.json",
    ]) {
      expect(generatedViolation(rel) ?? "").toContain("is generated");
    }
    for (const rel of ["apps/daemon/src/server.ts", "docs/coverage.md", "scripts/dist.ts"]) {
      expect(generatedViolation(rel)).toBeNull();
    }
  });

  test("checkoutRoot finds the main checkout or a worktree of the same repository", () => {
    const base = realTempDir("fd-hooks-");
    const main = join(base, "flightdeck");
    const worktree = join(base, "flightdeck-fase11");
    const other = join(base, "other");
    mkdirSync(join(main, ".git", "worktrees", "flightdeck-fase11"), { recursive: true });
    mkdirSync(join(worktree, "apps"), { recursive: true });
    writeFileSync(
      join(worktree, ".git"),
      `gitdir: ${join(main, ".git", "worktrees", "flightdeck-fase11")}\n`,
    );
    mkdirSync(join(other, ".git"), { recursive: true });

    expect(checkoutRoot(join(main, "apps", "x.ts"), main)).toBe(main);
    expect(checkoutRoot("apps/x.ts", main)).toBe(main);
    expect(checkoutRoot(join(worktree, "apps", "new-dir", "x.ts"), main)).toBe(worktree);
    expect(checkoutRoot(join(main, "x.ts"), worktree)).toBe(main);
    expect(checkoutRoot(join(other, "x.ts"), main)).toBeNull();
    expect(checkoutRoot(join(base, "loose.ts"), main)).toBeNull();
    expect(checkoutRoot(join(main, "x.ts"), base)).toBeNull();
  });

  test("checkoutRoot ignores a .git file that names no gitdir", () => {
    const base = realTempDir("fd-hooks-");
    const main = join(base, "flightdeck");
    const broken = join(base, "broken");
    mkdirSync(join(main, ".git"), { recursive: true });
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, ".git"), "not a gitdir line\n");
    expect(checkoutRoot(join(broken, "x.ts"), main)).toBeNull();
  });
});
