import { describe, expect, test } from "bun:test";
import { weakAssertViolation, weakerEscape } from "../lib/claude-hooks.ts";
import { summarizeHookLog } from "../lib/hook-log.ts";

// Built by concatenation so this file's own matchers are not the fixtures.
const m = (name: string, arg = "") => `.${name}(${arg})`;
const edit = (before: string, after: string, file = "apps/desktop/test/a.test.tsx") => ({
  file_path: file,
  old_string: before,
  new_string: after,
});
const none = () => null;

describe("hook: a weakened assertion (#1141)", () => {
  test("an edit that swaps toBe for toBeDefined is blocked, and the reason gives the escape", () => {
    const input = edit(`expect(id)${m("toBe", '"abc"')};`, `expect(id)${m("toBeDefined")};`);
    const reason = weakAssertViolation("Edit", input, none) ?? "";
    expect(reason).toContain("weakens an assertion");
    expect(reason).toContain("// weaker: <why>");
    expect(reason).toContain("#1141");
  });

  test("the escape, a stricter swap, a deleted test, and a file that is not a test pass", () => {
    const strict = `expect(id)${m("toBe", '"abc"')};`;
    const cases = [
      edit(strict, `expect(id)${m("toBeDefined")}; // weaker: ids are random since #12`),
      edit(`expect(id)${m("toBeDefined")};`, strict),
      edit(strict, ""),
      edit(strict, `expect(id)${m("toBeDefined")};`, "apps/desktop/src/a.ts"),
    ];
    for (const input of cases) expect(weakAssertViolation("Edit", input, none)).toBeNull();
  });

  test("a Write is judged against the file it replaces", () => {
    const write = { file_path: "scripts/test/b.test.ts", content: `expect(a)${m("toBeTruthy")};` };
    expect(
      weakAssertViolation("Write", write, () => `expect(a)${m("toEqual", "[1]")};`) ?? "",
    ).toContain("weakens an assertion");
    expect(weakAssertViolation("Write", write, none)).toBeNull();
  });

  test("an added // weaker: line gives its reason for the log; an old one or none gives null", () => {
    const escaped = `expect(id)${m("toBeDefined")}; // weaker: ids are random since #12`;
    const strict = `expect(id)${m("toBe", '"abc"')};`;
    expect(weakerEscape("Edit", edit(strict, escaped), none)).toBe("ids are random since #12");
    // #1143 review: a waiver is logged only for an edit the escape let through.
    expect(weakerEscape("Edit", edit("", escaped), none)).toBeNull();
    expect(weakerEscape("Edit", edit(strict, `${escaped}\r\n`), none)).toBe(
      "ids are random since #12",
    );
    expect(weakerEscape("Edit", edit(escaped, `${escaped}\nconst a = 1;`), none)).toBeNull();
    expect(weakerEscape("Edit", edit("", `expect(a)${m("toBe", "1")};`), none)).toBeNull();
  });

  test("security review: the reason logged is cut to 200 characters", () => {
    const long = `expect(id)${m("toBeDefined")}; // weaker: ${"x".repeat(500)}`;
    expect(weakerEscape("Edit", edit(`expect(id)${m("toBe", "1")};`, long), none)?.length).toBe(
      200,
    );
  });

  test("harness:stats lists the escapes as waivers of the weak-assert rule", () => {
    const line = JSON.stringify({
      t: "2026-11-08T00:00:00Z",
      hook: "guard",
      rule: "weak-assert",
      decision: "waived",
      ms: 3,
      detail: "ids are random since #12",
    });
    const out = summarizeHookLog(line);
    expect(out).toMatch(/waivers by rule:\n {2}weak-assert +1/);
    expect(out).not.toContain("blocks by rule:");
  });
});
