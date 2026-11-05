import { describe, expect, test } from "bun:test";
import { testEditViolation } from "../lib/claude-hooks.ts";

// Built by concatenation so this very file never contains the forbidden markers.
const ONLY = `.${"only"}(`;
const SKIP = `.${"skip"}(`;
const TODO = `test.${"todo"}(`;
const SNAPSHOT = `expect(x).${"toMatchSnapshot"}(`;

const edit = (file: string, before: string, after: string) =>
  testEditViolation("Edit", { file_path: file, old_string: before, new_string: after }, () => {
    throw new Error("an Edit never reads the file");
  });

describe("hook-test-markers", () => {
  test("an Edit that adds a forbidden marker to a test file is blocked and names it", () => {
    for (const [marker, line] of [
      [ONLY, `test${ONLY}"a", () => {})`],
      [SKIP, `describe${SKIP}"b", () => {})`],
      [TODO, `${TODO}"later")`],
      [`${"toMatchSnapshot"}(`, SNAPSHOT],
    ] as const) {
      const reason = edit("apps/daemon/test/a.test.ts", "", line) ?? "";
      expect(reason).toContain("is blocked");
      expect(reason).toContain(marker);
      expect(reason).toContain("docs/TDD.md");
    }
  });

  test("tsx files and Windows paths count as test files", () => {
    expect(edit("apps/desktop/test/b.test.tsx", "x", `it${ONLY}"x")`) ?? "").toContain(
      "is blocked",
    );
    expect(edit("apps\\desktop\\test\\b.test.tsx", "x", `it${SKIP}"x")`) ?? "").toContain(
      "is blocked",
    );
  });

  test("removing a marker, keeping one already there or skipIf passes", () => {
    expect(edit("a.test.ts", `it${ONLY}"x")`, `it("x")`)).toBeNull();
    expect(
      edit("a.test.ts", `it${SKIP}"x")\nconst a = 1;`, `it${SKIP}"x")\nconst a = 2;`),
    ).toBeNull();
    expect(
      edit("a.test.ts", "", "test.skipIf(process.platform === 'win32')('x', () => {})"),
    ).toBeNull();
  });

  test("files that are not tests are never checked", () => {
    expect(edit("apps/daemon/src/list.ts", "", `items${ONLY}1)`)).toBeNull();
    expect(edit("docs/TDD.md", "", `never use ${ONLY}`)).toBeNull();
  });

  test("a Write compares the new content with the file it replaces", () => {
    const existing = `it${SKIP}"old")\n`;
    const write = (content: string, current: string | null) =>
      testEditViolation("Write", { file_path: "scripts/test/c.test.ts", content }, (path) =>
        path === "scripts/test/c.test.ts" ? current : null,
      );
    expect(write(`${existing}it("new")\n`, existing)).toBeNull();
    expect(write(`${existing}it${ONLY}"new")\n`, existing) ?? "").toContain(ONLY);
    expect(write(`it${TODO}"x")\n`, null) ?? "").toContain(TODO);
  });

  test("a call with missing or odd fields passes (the hook fails open)", () => {
    expect(testEditViolation("Edit", { file_path: "a.test.ts" }, () => null)).toBeNull();
    expect(testEditViolation("Write", { file_path: 3, content: ONLY }, () => null)).toBeNull();
    expect(testEditViolation("Bash", { command: `echo ${ONLY}` }, () => null)).toBeNull();
  });
});
