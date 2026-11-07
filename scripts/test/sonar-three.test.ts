import { describe, expect, test } from "bun:test";
import { domEqualities, holdsElement } from "../lib/dom-equal-ratchet.ts";

const LIMIT_MS = 250;
const timed = <T>(run: () => T): { value: T; ms: number } => {
  const start = performance.now();
  const value = run();
  return { value, ms: performance.now() - start };
};
/** Built at run time so this file's own text holds no assertion for the scan to find. */
const expectOf = (actual: string, matcher: string, expected: string) =>
  `${"expect"}(${actual}).${matcher}(${expected});`;

describe("sonar-three: the DOM-equality scan keeps its matches and runs in linear time (#363)", () => {
  test("an object key is dropped before its value is read, whatever the key's own characters", () => {
    const keys: Array<[string, boolean]> = [
      ["a", true],
      ['"q r"', true],
      ["'q'", true],
      ["[a]", true],
      ["[a ]", true],
      ["$x", true],
      ["a b", true],
      ["a.b", false],
      ["a-b", false],
      ["...a", false],
      ["a:b", false],
      ["[[a]]", false],
      ["", false],
      [" ", true],
      ["\t", false],
      ["\n a", true],
      ["a\t", true],
    ];
    const answers = keys.map(([key]) => holdsElement(`{${key}: [el.closest("x")]}`));
    expect(answers).toEqual(keys.map(([, expected]) => expected));
  });

  test("a key made only of spaces and line breaks is a key when it holds a space", () => {
    expect(holdsElement(`{ \t: [el.closest("x")]}`)).toBe(true);
    expect(holdsElement(`{\t: [el.closest("x")]}`)).toBe(false);
    expect(holdsElement(`{\n : [el.closest("x")]}`)).toBe(true);
  });

  test("a long run of spaces before a stray character is read in linear time", () => {
    const cubic = timed(() => holdsElement(`{${" ".repeat(1500)}-}`));
    const quadratic = timed(() => holdsElement(`{a${" ".repeat(20_000)}-}`));
    expect([cubic.value, quadratic.value]).toEqual([false, false]);
    expect(cubic.ms).toBeLessThan(LIMIT_MS);
    expect(quadratic.ms).toBeLessThan(LIMIT_MS);
  });

  test("a query is found by its name, with or without a call, and only as a whole word", () => {
    const cases: Array<[string, boolean]> = [
      ['screen.getByRole("x")', true],
      ["screen.getAllByText(/a/)[0]", true],
      ["el.querySelectorAll('a')", true],
      ["document.getElementById('a')", true],
      ["x.findByLabelText('a')!", true],
      ["document.documentElement", true],
      ["document.body ?? null", true],
      ["document.activeElement)", true],
      ['[getByRole("a"), 1]', true],
      ["{ a: queryAllByTitle('t') }", true],
      ["getByText_1x('a')", true],
      ["closest ('a')", true],
      ["document.bodyx", false],
      ["notgetByRole('a')", false],
      ["getByrole('a')", false],
      ["fooclosest('a')", false],
      ['el.closest("a").x', false],
      ["queryBy ('a')", false],
      ["get ByRole('a')", false],
      ["querySelectorAllx('a')", false],
    ];
    expect(cases.map(([code]) => holdsElement(code))).toEqual(
      cases.map(([, expected]) => expected),
    );
  });

  test("a query name followed by a very long word is read in linear time", () => {
    const code = `getBy${"A".repeat(20_000)} ${" ".repeat(20_000)}x`;
    const run = timed(() => holdsElement(code));
    expect(run.value).toBe(false);
    expect(run.ms).toBeLessThan(LIMIT_MS);
  });

  test("brackets inside strings, comments and nested literals do not end the argument early", () => {
    const sources: Array<[string, number]> = [
      [expectOf('[tool, within(t).queryByRole("g)", { name: "a\\"b" })]', "toEqual", "[null]"), 1],
      [expectOf('[tool, /* ) ] } */ screen.getByText("v")]', "toStrictEqual", "[]"), 1],
      [expectOf("[tool, `getByRole(x)`, el.closest('a')]", "toMatchObject", "[]"), 1],
      [expectOf("{ a: [x, { b: document.body }], c: 1 }", "toEqual", "{}"), 1],
      [expectOf("{ a: [x, { b: 1 }], c: document.title }", "toEqual", "{}"), 0],
      [expectOf("{ ...rest, c: [1, f(2, 3), el.closest('a')!] }", "toEqual", "{}"), 1],
      [expectOf("[[1, 2], [3, el.closest('a')]]", "toEqual", "[]"), 1],
      [expectOf("x", "toEqual", "[a, // ) \n screen.getByRole('b')]"), 1],
      [expectOf("x", "toEqual", "'unterminated"), 0],
    ];
    expect(sources.map(([source]) => domEqualities(source))).toEqual(sources.map(([, n]) => n));
    expect(domEqualities(sources.map(([source]) => source).join("\n"))).toBe(7);
  });
});
