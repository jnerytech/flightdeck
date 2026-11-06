import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decisionFileProblem, FROZEN_DECISIONS_SHA256 } from "../lib/decisions.ts";

const ROOT = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("decisions-files (#304)", () => {
  test("a decision file is named <yyyy-mm-dd>-<topic>.md and titled after its issue or phase", () => {
    expect(
      decisionFileProblem("2026-11-05-ci-prints.md", "# Prints in four jobs (issue #291)"),
    ).toBeNull();
    expect(
      decisionFileProblem("2026-11-06-fase-40.md", "# Phase 40: the board (phase 40)"),
    ).toBeNull();
    // A note after the number, as in "(issue #109, part b)" (#340).
    expect(
      decisionFileProblem("2026-11-06-model-chip.md", "# The model chip (issue #109, part b)"),
    ).toBeNull();
    expect(decisionFileProblem("2026-11-06-model-chip.md", "# Chip (issue #109,)") ?? "").toContain(
      "a first line `# <title> (issue #N)` or `(phase N)`",
    );
    expect(decisionFileProblem("ci-prints.md", "# Prints (issue #291)") ?? "").toContain(
      "<yyyy-mm-dd>-<topic>.md",
    );
    expect(decisionFileProblem("2026-11-05-CI Prints.md", "# Prints (issue #291)") ?? "").toContain(
      "<yyyy-mm-dd>-<topic>.md",
    );
    expect(decisionFileProblem("2026-11-05-ci-prints.md", "Prints") ?? "").toContain(
      "a first line `# <title> (issue #N)` or `(phase N)`",
    );
    expect(decisionFileProblem("2026-11-05-ci-prints.md", "# Prints") ?? "").toContain(
      "a first line `# <title> (issue #N)` or `(phase N)`",
    );
  });

  test("docs/DECISIONS.md is frozen: a new entry goes to a file of its own under docs/decisions/", () => {
    const text = read("docs/DECISIONS.md");
    const sha = createHash("sha256").update(text).digest("hex");
    // Failing here: move the new entry to docs/decisions/<yyyy-mm-dd>-<topic>.md (docs/decisions/README.md).
    expect(sha).toBe(FROZEN_DECISIONS_SHA256);
    expect(text.split("\n").slice(0, 6).join("\n")).toContain("docs/decisions/");
  });

  test("every file under docs/decisions/ is a decision record, and the folder says how to add one", () => {
    expect(existsSync(join(ROOT, "docs/decisions/README.md"))).toBe(true);
    const files = readdirSync(join(ROOT, "docs/decisions")).filter((f) => f !== "README.md");
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const first = read(`docs/decisions/${file}`).split("\n")[0] ?? "";
      expect(`${file}: ${decisionFileProblem(file, first)}`).toBe(`${file}: null`);
    }
  });

  test("the instructions point to docs/decisions/ for a new entry", () => {
    for (const path of [
      "CLAUDE.md",
      ".claude/skills/new-phase/SKILL.md",
      ".claude/agents/spec-verifier.md",
      "docs/templates/SPEC.md",
    ]) {
      expect(`${path}: ${read(path).includes("docs/decisions/")}`).toBe(`${path}: true`);
    }
  });
});
