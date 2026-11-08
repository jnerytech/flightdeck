import { describe, expect, test } from "bun:test";
import { testEditViolation } from "../lib/claude-hooks.ts";
import { findForbiddenMarkers } from "../lib/tdd-audit.ts";

// Built by concatenation so this very file never holds a marker the audit counts.
const SKIPIF = `${"skip"}${"If"}(`;
const ONLY = `.${"only"}(`;
const SKIP = `.${"skip"}(`;
const TODO = `test.${"todo"}(`;

const edit = (before: string, after: string, file = "apps/desktop/test/a.test.tsx") =>
  testEditViolation("Edit", { file_path: file, old_string: before, new_string: after }, () => {
    throw new Error("an Edit never reads the file");
  });

const platform = (head: string, condition: string) =>
  `${head}.${SKIPIF}${condition})("x", () => {});`;

describe("hook-skip: a flaky test is deleted, never skipped (#1003, #169)", () => {
  test("a .skip on any receiver is blocked, and the reason says to delete or replace it", () => {
    for (const text of [
      `test${SKIP}"x", () => {})`,
      `describe${SKIP}"x", () => {})`,
      `test.concurrent${SKIP}"x", () => {})`,
    ]) {
      const reason = edit("", text) ?? "";
      expect(reason).toContain("is blocked");
      expect(reason).toContain("a flaky test is deleted, never skipped");
      expect(reason).toContain("#1003");
      expect(reason).toContain("docs/TDD.md");
    }
  });

  test("#169: a `// unstable: #N <reason>` note no longer lets a skip through", () => {
    const note = "// unstable: #484 reads the status late on a loaded runner\n";
    expect(edit("", `${note}describe${SKIP}"x", () => {})`) ?? "").toContain("never skipped");
    expect(edit("", `test${SKIP}"x", () => {}) // unstable: #492 races`) ?? "").toContain(
      "never skipped",
    );
  });

  test("#169: a skipIf for a platform passes, off Linux included", () => {
    for (const condition of [
      "process.platform === 'win32'",
      "!volumeHas83Names()",
      "notLinux",
      'process.platform !== "linux"',
    ]) {
      expect(`${condition}: ${edit("", platform("test", condition))}`).toBe(`${condition}: null`);
    }
  });

  test("a skip already in the file does not block an unrelated edit, a second one does", () => {
    const old = `test${SKIP}"x", () => {});\nconst a = 1;`;
    expect(edit(old, `test${SKIP}"x", () => {});\nconst a = 2;`)).toBeNull();
    expect(edit(old, `${old}\nit${SKIP}"y", () => {});`) ?? "").toContain("is blocked");
  });

  test("a Write is judged on what it adds to the file", () => {
    const write = (content: string, current: string | null) =>
      testEditViolation("Write", { file_path: "scripts/test/c.test.ts", content }, () => current);
    expect(write(`test${SKIP}"x", () => {});`, null) ?? "").toContain("is blocked");
    expect(write(`// unstable: #288 x\ntest${SKIP}"x", () => {});`, null) ?? "").toContain(
      "is blocked",
    );
    expect(write(`test${SKIP}"x", () => {});\n`, `test${SKIP}"x", () => {});\n`)).toBeNull();
  });

  test("#169: the hook refuses what the audit refuses, plus a first-run snapshot", () => {
    const cases = [
      `test${SKIP}"x", () => {});`,
      `// unstable: #7 late\ntest${SKIP}"x", () => {});`,
      `it${ONLY}"x", () => {});`,
      `${TODO}"x");`,
      platform("test", "process.platform === 'win32'"),
      platform("describe", "notLinux"),
      `test("plain", () => {});`,
    ];
    for (const text of cases) {
      const hook = edit("", text) !== null;
      const audit = findForbiddenMarkers([{ path: "a.test.ts", content: text }]).length > 0;
      expect(`${text}: hook ${hook}`).toBe(`${text}: hook ${audit}`);
    }
    expect(edit("", `expect(x).${"toMatchSnapshot"}()`) ?? "").toContain("is blocked");
  });
});
