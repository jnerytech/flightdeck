import { describe, expect, test } from "bun:test";
import { bash, notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const PERSONA =
  "changes what the app asks a person to confirm (flightdeckd persona save, remove, reset, trust or publish-agent)";

/**
 * A word that ends in `)`, `}` or a backtick is read without them, so `(fd persona remove qa)` is the verb and
 * not a word the rules do not know (#3665). The rows pin which characters are taken off and how many.
 */
describe("risk rules: the closing characters at the end of a word (#3665)", () => {
  test("one, two or three of them after the last word do not hide the verb", () => {
    expect(
      wrongReasons([
        ["fd persona remove qa)", PERSONA],
        ["fd persona remove qa))", PERSONA],
        ["fd persona remove qa)}`", PERSONA],
        ["fd persona remove qa}", PERSONA],
        ["fd persona remove qa`", PERSONA],
        ["(fd persona remove qa)", PERSONA],
        ["{ fd persona remove qa; }", PERSONA],
        ["fd persona remove qa", PERSONA],
      ]),
    ).toEqual([]);
  });

  test("one inside a word is part of it, and a word without any is read as it is", () => {
    expect(notHigh(["echo a)b", "echo a}b", "fd persona list", "fd persona show qa)"])).toEqual([]);
  });

  test("a word made of thousands of them is read in linear time", () => {
    const start = performance.now();
    const risk = bash(`fd persona remove ${")".repeat(30_000)}x`);
    const ms = performance.now() - start;
    expect([risk.level, risk.reason]).toEqual(["high", PERSONA]);
    expect(ms).toBeLessThan(2500);
  });
});
