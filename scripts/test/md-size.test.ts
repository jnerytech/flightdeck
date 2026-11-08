import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { overBaseline } from "../lib/layout-ratchet.ts";
import { mdLimit, oversized } from "../lib/md-size.ts";

// repo-wide (#1108): reads every tracked doc, so CI's quick job runs it on every PR.

const ROOT = resolve(import.meta.dir, "../..");
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

  test("the root CLAUDE.md and the manuals have fixed limits of their own, out of the baseline: they grow by design (#427)", () => {
    // Lines of the root CLAUDE.md wait for the owner's word; every phase adds to both manuals.
    expect(mdLimit("CLAUDE.md")).toBe(260);
    expect(mdLimit("docs/manual/en.md")).toBe(4500);
    expect(mdLimit("docs/manual/pt-BR.md")).toBe(4500);
    expect(oversized([{ path: "docs/manual/en.md", text: lines(4500) }])).toEqual({});
    expect(oversized([{ path: "docs/manual/pt-BR.md", text: lines(4501) }])).toEqual({
      "docs/manual/pt-BR.md": 4501,
    });
    expect(oversized([{ path: "CLAUDE.md", text: lines(261) }])).toEqual({ "CLAUDE.md": 261 });
    const baseline = JSON.parse(readFileSync(join(ROOT, "md-size-baseline.json"), "utf8"));
    expect(Object.keys(baseline)).toEqual(["docs/SPEC-fase-40.md"]);
  });

  test("the frozen DECISIONS.md has no cap: decisions.ts pins its content, and new decisions go to docs/decisions/ (#304)", () => {
    expect(mdLimit("docs/DECISIONS.md")).toBe(Number.POSITIVE_INFINITY);
    expect(oversized([{ path: "docs/DECISIONS.md", text: lines(5000) }])).toEqual({});
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
