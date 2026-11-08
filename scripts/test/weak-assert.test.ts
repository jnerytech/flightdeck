import { describe, expect, test } from "bun:test";
import { assertionCounts, weakensAssertions } from "../lib/weak-assert.ts";

// Built by concatenation so the matchers read here are the fixtures' only.
const m = (name: string, arg = "") => `.${name}(${arg})`;

describe("weak-assert (#1141)", () => {
  test("strict and weak matchers are counted apart, toBe( never as toBeTruthy(", () => {
    const text = [
      `expect(a)${m("toBe", "1")};`,
      `expect(b)${m("toEqual", "[]")};`,
      `expect(c)${m("toBeTruthy")};`,
      `expect(d).not${m("toBeNull")};`,
      `expect(e)${m("toBeDefined")};`,
      `expect(f).toEqual(expect.anything());`,
      `expect(g)${m("toContain", '"x"')};`,
    ].join("\n");
    expect(assertionCounts(text)).toEqual({ strict: 3, weak: 4, escaped: 0 });
  });

  test("a weak matcher on a `// weaker: <why>` line is not counted, and the escape is", () => {
    const text = `expect(a)${m("toBeDefined")}; // weaker: the id is random\nexpect(b)${m("toBeTruthy")}; // weaker:`;
    expect(assertionCounts(text)).toEqual({ strict: 0, weak: 1, escaped: 1 });
  });

  test("swapping a strict matcher for a weak one weakens; the escape lets it through", () => {
    const before = `expect(id)${m("toBe", '"abc"')};`;
    expect(weakensAssertions(before, `expect(id)${m("toBeDefined")};`)).toBe(true);
    expect(weakensAssertions(before, `expect(id).not${m("toBeUndefined")};`)).toBe(true);
    expect(
      weakensAssertions(before, `expect(id)${m("toBeDefined")}; // weaker: ids are random now`),
    ).toBe(false);
  });

  test("deleting a test, adding one, or a stricter swap does not weaken", () => {
    const strict = `expect(a)${m("toBe", "1")};\nexpect(b)${m("toBeTruthy")};`;
    expect(weakensAssertions(strict, "")).toBe(false);
    expect(weakensAssertions("", strict)).toBe(false);
    expect(
      weakensAssertions(`expect(a)${m("toBeTruthy")};`, `expect(a)${m("toBe", "true")};`),
    ).toBe(false);
    expect(weakensAssertions(strict, `${strict}\nexpect(c)${m("toBeDefined")};`)).toBe(false);
  });
});
