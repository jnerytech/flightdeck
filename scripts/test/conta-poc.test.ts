import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

/** The phase 34 record, a file of its own since DECISIONS.md became an index (#1711). */
function phase34Section(): string {
  return readFileSync(
    resolve(ROOT, "docs/decisions/2026-11-03-phase-34-claude-account-card.md"),
    "utf8",
  );
}

describe("conta-poc: the proof of concept answers are recorded in the phase 34 decision record", () => {
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
