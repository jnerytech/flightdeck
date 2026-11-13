import { describe, expect, test } from "bun:test";
import { cacheKey, keyFiles } from "../../lib/mutation/cache-key.ts";

const domain = (name: string, mutate: string[], tests: string[]) => ({ name, mutate, tests });

describe("mutation cache key: a verdict is reused only while its sources and tests are the same (#2485)", () => {
  const tree = (over: Record<string, string> = {}) => {
    const files: Record<string, string> = {
      "src/a.ts": "export const a = 1;",
      "test/a.test.ts": "expect(a).toBe(1);",
      ...over,
    };
    return (path: string) => files[path] ?? "";
  };
  const files = ["src/a.ts", "test/a.test.ts"];

  test("the same files give the same key, and the key is a 64-character hex digest", () => {
    expect(cacheKey(files, tree())).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKey(files, tree())).toBe(cacheKey(files, tree()));
  });

  test("a changed test file gives another key", () => {
    expect(cacheKey(files, tree({ "test/a.test.ts": "expect(a).toBe(2);" }))).not.toBe(
      cacheKey(files, tree()),
    );
  });

  test("a changed source file gives another key", () => {
    expect(cacheKey(files, tree({ "src/a.ts": "export const a = 2;" }))).not.toBe(
      cacheKey(files, tree()),
    );
  });

  test("a file added to the list gives another key, even when it is empty", () => {
    expect(cacheKey([...files, "test/b.test.ts"], tree())).not.toBe(cacheKey(files, tree()));
  });

  test("text moved from the end of one file to the start of the next gives another key", () => {
    const one = (path: string) => (path === "src/a.ts" ? "ab" : "c");
    const two = (path: string) => (path === "src/a.ts" ? "a" : "bc");
    expect(cacheKey(["src/a.ts", "test/a.test.ts"], one)).not.toBe(
      cacheKey(["src/a.ts", "test/a.test.ts"], two),
    );
  });
});

describe("mutation cache key: the files of every domain count (#2485)", () => {
  test("lists each domain's sources and tests once, in a stable order", () => {
    const list = keyFiles([
      domain("one", ["src/b.ts", "src/a.ts"], ["test/shared.test.ts"]),
      domain("two", ["src/c.ts"], ["test/shared.test.ts", "test/c.test.ts"]),
    ]);
    expect(list).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "test/c.test.ts",
      "test/shared.test.ts",
    ]);
  });

  test("no domain means no files", () => {
    expect(keyFiles([])).toEqual([]);
  });
});
