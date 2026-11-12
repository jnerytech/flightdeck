import { expect, test } from "bun:test";
import { GlobalSnippets } from "../../src/features/snippets/index.ts";

const planted = (raw: string) => ({
  storage: {
    getItem: (key: string) => (key === "flightdeck.snippets" ? raw : null),
    setItem: () => {},
  },
});

const KEPT = {
  id: "s1",
  def: { name: "Greet", type: "command", run: "echo hi", text: null, vars: {}, tags: [] },
  favorite: false,
  uses: 0,
  lastUsedAt: null,
};

// What a reader gives, or "threw": a red must fail by assertion, not by an error.
const attempt = <T>(read: () => T) => {
  try {
    return read();
  } catch {
    return "threw";
  }
};

test("a stored snippet that is not a snippet is left out and the others stay (#1609)", () => {
  const raw = JSON.stringify([KEPT, { ...KEPT, id: "s2", favorite: "yes" }, "junk"]);
  expect(attempt(() => new GlobalSnippets(planted(raw)).list().map((s) => s.id))).toEqual(["s1"]);
});

test("stored snippets that are not a list read as none (#1609)", () => {
  expect(attempt(() => new GlobalSnippets(planted('{"id":"s1"}')).list())).toEqual([]);
  expect(attempt(() => new GlobalSnippets(planted("not json")).list())).toEqual([]);
});
