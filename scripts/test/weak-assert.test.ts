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

  test("replay of 200 PRs: `expect(x !== null).toBe(true)` to `expect(x).not.toBeNull()` does not weaken", () => {
    expect(
      weakensAssertions(
        `expect(x !== null)${m("toBe", "true")};`,
        `expect(x).not${m("toBeNull")};`,
      ),
    ).toBe(false);
    // Replay after the #1143 review (#943): instanceof in the subject is a comparison too.
    expect(
      weakensAssertions(
        `expect(error instanceof AcpError)${m("toBe", "true")};`,
        `expect(error)${m("toBeInstanceOf", "AcpError")};`,
      ),
    ).toBe(false);
    // #1143 review: on a plain subject, toBe(false) is strict, and toBeFalsy() weaker.
    expect(
      weakensAssertions(`expect(ok)${m("toBe", "false")};`, `expect(ok)${m("toBeFalsy")};`),
    ).toBe(true);
    // Security review: a comma or spaces before the `)` read the same, and a long run of spaces
    // with no `)` is still a strict matcher.
    expect(assertionCounts(`expect(a === b)${m("toBe", "true ,")};`).strict).toBe(0);
    expect(assertionCounts(`expect(a).toBe(true${" ".repeat(50)}`).strict).toBe(1);
    // The formatter's line break after `toBe(` changes nothing.
    const wrapped = `expect(x !== null)${m("toBe", "\n      true,\n    ")};`;
    expect(weakensAssertions(wrapped, `expect(x).not${m("toBeNull")};`)).toBe(false);
  });

  test("#1143 review: a swap on one subject weakens even when the edit adds a strict check elsewhere", () => {
    expect(
      weakensAssertions(
        `expect(id)${m("toBe", '"abc"')};`,
        `expect(id)${m("toBeDefined")};\nexpect(n)${m("toBe", "1")};`,
      ),
    ).toBe(true);
    // A paren inside a string does not end the subject.
    expect(
      weakensAssertions(`expect(f("("))${m("toBe", "1")};`, `expect(f("("))${m("toBeDefined")};`),
    ).toBe(true);
  });

  test("#1143 review: an empty toThrow, expect.any, an empty toMatchObject and the like are weak", () => {
    const pairs: [string, string][] = [
      [`expect(run)${m("toThrow", '"no repo"')};`, `expect(run)${m("toThrow")};`],
      [`expect(v)${m("toEqual", '"x"')};`, `expect(v)${m("toEqual", "expect.any(String)")};`],
      [`expect(v)${m("toEqual", "{ a: 1 }")};`, `expect(v)${m("toMatchObject", "{}")};`],
      [`expect(n)${m("toBe", "1")};`, `expect(n)${m("toBeGreaterThan", "0")};`],
      [`expect(f)${m("toHaveBeenCalledWith", "1")};`, `expect(f)${m("toHaveBeenCalled")};`],
      [`expect(e)${m("toEqual", "err")};`, `expect(e)${m("toBeInstanceOf", "Error")};`],
    ];
    for (const [before, after] of pairs) {
      expect(`${after}: ${weakensAssertions(before, after)}`).toBe(`${after}: true`);
    }
  });

  test("#1143 review: a CRLF file reads the same, escape included", () => {
    const text = `expect(a)${m("toBeDefined")}; // weaker: the id is random\r\nexpect(b)${m("toBe", "1")};\r\n`;
    expect(assertionCounts(text)).toEqual({ strict: 1, weak: 0, escaped: 1 });
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
