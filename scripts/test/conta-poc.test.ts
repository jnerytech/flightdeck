import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

function phase34Section(): string {
  const text = readFileSync(resolve(ROOT, "docs/DECISIONS.md"), "utf8");
  const start = text.search(/^## Phase 34\b/m);
  if (start < 0) return "";
  const rest = text.slice(start + 1);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("conta-poc: the proof of concept answers are recorded in DECISIONS.md", () => {
  test("phase 34 has one numbered answer for each of the six questions", () => {
    const section = phase34Section();
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(section).toMatch(new RegExp(`^${n}\\. `, "m"));
    }
  });

  test("every answer names the claude version it was observed with", () => {
    const answers = phase34Section()
      .split("\n")
      .filter((line) => /^[1-6]\. /.test(line));
    expect(answers).toHaveLength(6);
    for (const line of answers) expect(line).toContain("claude 2.1.317");
  });

  test("the answers use only a throwaway config directory for the signed-out case", () => {
    expect(phase34Section()).toContain("throwaway");
  });
});
