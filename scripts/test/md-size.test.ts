import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { overBaseline } from "../lib/layout-ratchet.ts";
import { mdLimit, oversized } from "../lib/md-size.ts";

const ROOT = resolve(import.meta.dir, "../..");
const lines = (n: number) => "x\n".repeat(n);

describe("md-size", () => {
  test("CLAUDE.md files, rules and agents get 150 lines, skills 300, every other doc 400", () => {
    expect(mdLimit("CLAUDE.md")).toBe(150);
    expect(mdLimit("apps/daemon/CLAUDE.md")).toBe(150);
    expect(mdLimit(".claude/rules/ui.md")).toBe(150);
    expect(mdLimit(".claude/agents/spec-verifier.md")).toBe(150);
    expect(mdLimit(".claude/skills/tdd-area/SKILL.md")).toBe(300);
    expect(mdLimit("docs/SPEC-fase-38.md")).toBe(400);
    expect(mdLimit("README.md")).toBe(400);
  });

  test("only the files over their limit are counted", () => {
    expect(
      oversized([
        { path: "CLAUDE.md", text: lines(151) },
        { path: "docs/a.md", text: lines(400) },
        { path: "docs/b.md", text: `${lines(400)}x` },
      ]),
    ).toEqual({ "CLAUDE.md": 151, "docs/b.md": 401 });
  });

  test("no tracked Markdown file is over its limit beyond md-size-baseline.json", () => {
    const paths = spawnSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" })
      .stdout.split("\n")
      .filter(Boolean);
    const counts = oversized(
      paths.map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") })),
    );
    const file = join(ROOT, "md-size-baseline.json");
    const baseline = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    expect(overBaseline(counts, baseline)).toEqual([]);
  });
});
