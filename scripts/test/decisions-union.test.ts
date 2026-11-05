import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realTempDir } from "./temp-dir.ts";

const ROOT = join(import.meta.dir, "..", "..");
const ATTRIBUTES = join(ROOT, ".gitattributes");
const RULE = "docs/DECISIONS.md merge=union";
const base = "# Decisions\n\n## Phase 1\n\n- one\n";
const section = (name: string) => `\n## ${name}\n\n- ${name} decided something.\n`;

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]) {
  const run = Bun.spawnSync(
    ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args],
    { cwd: dir },
  );
  return { code: run.exitCode, out: run.stdout.toString() + run.stderr.toString() };
}

/** A temporary repository where two branches each append a section to DECISIONS.md, and one merges the other. */
function twoAppends(attributes: boolean) {
  const dir = realTempDir("decisions-union-");
  made.push(dir);
  git(dir, "init", "-q", "-b", "main");
  mkdirSync(join(dir, "docs"));
  writeFileSync(join(dir, "docs/DECISIONS.md"), base);
  if (attributes) copyFileSync(ATTRIBUTES, join(dir, ".gitattributes"));
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "base");
  for (const name of ["a", "b"]) {
    git(dir, "switch", "-q", "-c", name, "main");
    writeFileSync(join(dir, "docs/DECISIONS.md"), base + section(`Section ${name}`));
    git(dir, "commit", "-q", "-am", `append ${name}`);
  }
  git(dir, "switch", "-q", "a");
  const merged = git(dir, "merge", "--no-edit", "b");
  return { merged, text: readFileSync(join(dir, "docs/DECISIONS.md"), "utf8") };
}

describe("decisions-union", () => {
  test(".gitattributes merges docs/DECISIONS.md with the union driver", () => {
    const lines = readFileSync(ATTRIBUTES, "utf8").split("\n");
    expect(lines).toContain(RULE);
  });

  test("two branches that each append a section merge with no conflict and keep both", () => {
    const { merged, text } = twoAppends(true);
    expect(merged.code).toBe(0);
    expect(text).toContain("## Phase 1");
    expect(text).toContain("## Section a");
    expect(text).toContain("## Section b");
    expect(text).not.toContain("<<<<<<<");
  });

  test("without the rule the same two appends do conflict (so the test above can fail)", () => {
    const { merged, text } = twoAppends(false);
    expect(merged.code).not.toBe(0);
    expect(text).toContain("<<<<<<<");
  });
});
