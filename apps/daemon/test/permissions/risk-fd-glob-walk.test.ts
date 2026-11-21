import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

/** The verb that follows is the one a rule reads: it is `persona remove`, which is high once the program is the CLI. */
const tail = " persona remove qa";

describe("risk rules: which glob in a program word may be the CLI (#3523)", () => {
  test("a bracket expression stands for one character, whatever it holds", () => {
    expect(
      wrongReasons(
        [
          "f[abcd]",
          "f[a-d]",
          "f[!x]",
          "f[^x]",
          "f[]d]",
          "f[!]d]",
          "f[[:alpha:]]",
          "[f]d",
          "f[x]ightdeckd",
          "f[l][i]ghtdeckd",
        ].map((word) => [word + tail, HIDDEN]),
      ),
    ).toEqual([]);
  });

  test("a star or a question mark is read the same way", () => {
    expect(
      wrongReasons(["f?", "?d", "f*d", "fl*htdeckd", "*", "f**d"].map((w) => [w + tail, HIDDEN])),
    ).toEqual([]);
  });

  test("a bracket that never closes is a plain character, so no CLI name matches", () => {
    expect(notHigh(["f[", "f[d", "f[[:alpha:", "f[!d"].map((word) => word + tail))).toEqual([]);
  });

  test("a bracket that skips past the end of its expression keeps the rest of the word literal", () => {
    expect(notHigh(["f[ab]d", "f[x]ightdeckx", "fd?"].map((word) => word + tail))).toEqual([]);
  });
});
