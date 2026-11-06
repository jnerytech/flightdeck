import { describe, expect, test } from "bun:test";
import { testEditViolation } from "../lib/claude-hooks.ts";
import { unstableSkips } from "../lib/unstable-skip.ts";

// Built by concatenation so this very file never holds a skip the ratchet counts.
const SKIPIF = `${"skip"}${"If"}(`;
const ONLY = `.${"only"}(`;
const SKIP = `.${"skip"}(`;

const edit = (before: string, after: string, file = "apps/desktop/test/a.test.tsx") =>
  testEditViolation("Edit", { file_path: file, old_string: before, new_string: after }, () => {
    throw new Error("an Edit never reads the file");
  });

const bare = (head: string, condition = "notLinux") =>
  `${head}.${SKIPIF}${condition})("x", () => {});`;

describe("hook-skip: a test skipped off Linux names the issue that owns its fix", () => {
  test("a skip off Linux with no comment is blocked and says what to write", () => {
    for (const head of ["test", "it", "describe"]) {
      const reason = edit("", bare(head)) ?? "";
      expect(reason).toContain("is blocked");
      expect(reason).toContain("// unstable: #<issue> <reason>");
      expect(reason).toContain("docs/TDD.md");
    }
    expect(edit("", bare("test", 'process.platform !== "linux"')) ?? "").toContain("is blocked");
    expect(edit("", bare("test", "process.platform !== 'linux'")) ?? "").toContain("is blocked");
  });

  test("the comment on the same line or on the line above lets it through", () => {
    expect(edit("", `${bare("test")} // unstable: #288 wall-clock polls`)).toBeNull();
    expect(edit("", `// unstable: #288 wall-clock polls\n${bare("test")}`)).toBeNull();
    expect(
      edit(
        "",
        `  // unstable: #12 spawns biome\n  ${bare("describe", 'process.platform !== "linux"')}`,
      ),
    ).toBeNull();
  });

  test("a comment with no issue number, no reason, a blank line between or two lines above does not count", () => {
    for (const text of [
      `${bare("test")} // unstable: flaky`,
      `${bare("test")} // unstable: #288`,
      `${bare("test")} // unstable: #288 `,
      `${bare("test")} // flaky: #288 wall-clock`,
      `// unstable: #288 wall-clock\n\n${bare("test")}`,
      `// unstable: #288 wall-clock\nconst a = 1;\n${bare("test")}`,
    ]) {
      expect(edit("", text) ?? "").toContain("is blocked");
    }
  });

  test("a skip for a platform capability needs no comment, as before", () => {
    expect(edit("", bare("test", "process.platform === 'win32'"))).toBeNull();
    expect(edit("", bare("describe", "!volumeHas83Names()"))).toBeNull();
  });

  test("an undocumented skip already in the file does not block an unrelated edit, a second one does", () => {
    const old = `${bare("test")}\nconst a = 1;`;
    expect(edit(old, `${bare("test")}\nconst a = 2;`)).toBeNull();
    expect(edit(old, `${old}\n${bare("it")}`) ?? "").toContain("is blocked");
  });

  test("the comment excuses nothing else: .skip, .only, test.todo and a snapshot stay blocked", () => {
    const note = "// unstable: #288 wall-clock polls\n";
    expect(edit("", `${note}describe${SKIP}"x", () => {})`) ?? "").toContain("is blocked");
    expect(edit("", `${note}it${ONLY}"x", () => {})`) ?? "").toContain("is blocked");
    expect(edit("", `${note}test.${"todo"}("x")`) ?? "").toContain("is blocked");
    expect(edit("", `${note}expect(x).${"toMatchSnapshot"}()`) ?? "").toContain("is blocked");
  });

  test("a Write is judged on what it adds to the file", () => {
    const write = (content: string, current: string | null) =>
      testEditViolation("Write", { file_path: "scripts/test/c.test.ts", content }, () => current);
    expect(write(bare("test"), null) ?? "").toContain("is blocked");
    expect(write(`// unstable: #288 x\n${bare("test")}`, null)).toBeNull();
    expect(write(`${bare("test")}\n`, `${bare("test")}\n`)).toBeNull();
  });

  test("the parser lists each skip with its line and whether its comment is complete", () => {
    const source = [
      "const a = 1;",
      `// unstable: #288 wall-clock polls`,
      bare("test"),
      bare("it", 'process.platform !== "linux"'),
      `${bare("describe")} // unstable: #7 spawns`,
      bare("test", "process.platform === 'win32'"),
    ].join("\n");
    expect(unstableSkips(source)).toEqual([
      { line: 3, documented: true },
      { line: 4, documented: false },
      { line: 5, documented: true },
    ]);
    expect(unstableSkips("")).toEqual([]);
  });
});
