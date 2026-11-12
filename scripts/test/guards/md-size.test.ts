import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mdLimit, oversized } from "../../lib/guards/md-size.ts";
import { overBaseline } from "../../lib/ratchets/layout.ts";

// repo-wide (#1108): reads every tracked doc, so CI's quick job runs it on every PR.

const ROOT = resolve(import.meta.dir, "../../..");
const lines = (n: number) => "x\n".repeat(n);

describe("md-size", () => {
  test("CLAUDE.md files, rules and agents get 150 lines, skills 300, every other doc 400", () => {
    expect(mdLimit("apps/daemon/CLAUDE.md")).toBe(150);
    expect(mdLimit(".claude/rules/ui.md")).toBe(150);
    expect(mdLimit(".claude/agents/spec-verifier.md")).toBe(150);
    expect(mdLimit(".claude/skills/tdd-area/SKILL.md")).toBe(300);
    expect(mdLimit("docs/SPEC-fase-38.md")).toBe(400);
    expect(mdLimit("README.md")).toBe(400);
  });

  test("a manual's index and each of its chapters get the 400 of any doc: a phase adds to a chapter, not to one big file (#1711)", () => {
    expect(mdLimit("docs/manual/en.md")).toBe(400);
    expect(mdLimit("docs/manual/pt-BR/board.md")).toBe(400);
    expect(oversized([{ path: "docs/manual/en/board.md", text: lines(400) }])).toEqual({});
    expect(oversized([{ path: "docs/manual/en/board.md", text: lines(401) }])).toEqual({
      "docs/manual/en/board.md": 401,
    });
    expect(oversized([{ path: "docs/manual/pt-BR.md", text: lines(401) }])).toEqual({
      "docs/manual/pt-BR.md": 401,
    });
  });

  test("the root CLAUDE.md has a fixed limit of its own, out of the baseline: it grows by design (#427)", () => {
    // Every session reads it whole, so the commands and the delegation rules moved to docs/ (#1973) and it cannot grow back.
    expect(mdLimit("CLAUDE.md")).toBe(170);
    expect(oversized([{ path: "CLAUDE.md", text: lines(170) }])).toEqual({});
    expect(oversized([{ path: "CLAUDE.md", text: lines(171) }])).toEqual({ "CLAUDE.md": 171 });
    const baseline = JSON.parse(readFileSync(join(ROOT, "md-size-baseline.json"), "utf8"));
    // Empty since the phase 40 spec moved its design to a file of its own (#1711): nothing is over its limit.
    expect(Object.keys(baseline)).toEqual([]);
  });

  test("DECISIONS.md, an index of links since its entries became files (#1711), gets the 400 of any doc", () => {
    expect(mdLimit("docs/DECISIONS.md")).toBe(400);
    expect(oversized([{ path: "docs/DECISIONS.md", text: lines(401) }])).toEqual({
      "docs/DECISIONS.md": 401,
    });
  });

  test("only the files over their limit are counted", () => {
    expect(
      oversized([
        { path: "apps/daemon/CLAUDE.md", text: lines(151) },
        { path: "docs/a.md", text: lines(400) },
        { path: "docs/b.md", text: `${lines(400)}x` },
      ]),
    ).toEqual({ "apps/daemon/CLAUDE.md": 151, "docs/b.md": 401 });
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
