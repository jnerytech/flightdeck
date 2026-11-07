import { describe, expect, test } from "bun:test";
import { Command, ReviewTarget } from "../src/index.ts";

/**
 * Issue #797: the context panel's daemon side. A project's own checkout is a target, and a search
 * over a repository takes a fixed string the daemon hands to a program: never a control character,
 * never longer than the panel needs.
 */
const search = (payload: Record<string, unknown>) =>
  Command.safeParse({ id: "1", type: "file.search", payload }).success;

describe("file-search: the protocol of a project's files and their search (#797)", () => {
  test("a project's id is a target, next to a session, a card and a terminal", () => {
    expect(
      ["project:p1", "session:s1", "card:c1", "terminal:t1", "project:", "folder:/etc"].map(
        (target) => ReviewTarget.safeParse(target).success,
      ),
    ).toEqual([true, true, true, true, false, false]);
  });

  test("a search names its target, its mode and a short fixed string", () => {
    expect([
      search({ target: "project:p1", mode: "name", query: "app.ts" }),
      search({ target: "card:c1", mode: "content", query: "TODO", limit: 200 }),
      search({ target: "project:p1", mode: "regex", query: "a.*" }),
      search({ target: "project:p1", mode: "name", query: "" }),
      search({ target: "project:p1", mode: "name", query: "x".repeat(201) }),
      search({ target: "project:p1", mode: "name", query: "x", limit: 0 }),
      search({ target: "project:p1", mode: "name", query: "x", limit: 201 }),
      search({ target: "project:p1", mode: "name", query: "x", limit: 1.5 }),
      search({ target: "project:p1", mode: "name", query: "x", extra: true }),
    ]).toEqual([true, true, false, false, false, false, false, false, false]);
  });

  test("a query with a control character never reaches the program", () => {
    expect(
      ["a\u0000b", "a\nb", "a\rb", "a\tb", "a\u001bb", "ação ✓"].map((query) =>
        search({ target: "project:p1", mode: "content", query }),
      ),
    ).toEqual([false, false, false, false, false, true]);
  });
});
