import { describe, expect, test } from "bun:test";
import { parseChecks, parsePrUrl } from "../../src/github/adapters/gh-json.ts";

describe("gh-json: what gh prints for a PR", () => {
  test("a check with no link reads as an empty link", () => {
    expect(parseChecks('[{"name":"lint","bucket":"pass","link":null}]')).toEqual([
      { name: "lint", bucket: "pass", link: "" },
    ]);
  });
  test("checks that are not a list are refused", () => {
    expect(() => parseChecks('{"name":"lint"}')).toThrow();
  });
  test("the PR address is read, and output without one is null", () => {
    expect(parsePrUrl('{"url":"https://github.com/o/r/pull/1"}')).toBe(
      "https://github.com/o/r/pull/1",
    );
    expect(parsePrUrl("{}")).toBeNull();
    expect(parsePrUrl('{"url":null}')).toBeNull();
  });
});
