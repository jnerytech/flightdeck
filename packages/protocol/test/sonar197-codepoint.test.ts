import { describe, expect, test } from "bun:test";
import { hasControl } from "../src/snippets.ts";

/** #197 (Sonar S7758): which characters count as control, edges included, astral ones too. */
describe("sonar197-codepoint: hasControl", () => {
  test("flags code points below 32 and 127, nothing else", () => {
    expect(hasControl(String.fromCodePoint(31), "")).toBe(true);
    expect(hasControl(String.fromCodePoint(0), "")).toBe(true);
    expect(hasControl(String.fromCodePoint(127), "")).toBe(true);
    expect(hasControl(String.fromCodePoint(32), "")).toBe(false);
    expect(hasControl(String.fromCodePoint(126), "")).toBe(false);
    expect(hasControl("plain text", "")).toBe(false);
  });

  test("a character outside the BMP is one character and never a control", () => {
    expect(hasControl("a😀b", "")).toBe(false);
    expect(hasControl("😀\u0007", "")).toBe(true);
  });

  test("the allowed characters pass, the other controls still do not", () => {
    expect(hasControl("a\tb", "\t")).toBe(false);
    expect(hasControl("a\nb", "\t")).toBe(true);
    expect(hasControl("a\tb\r\nc", "\t\n\r")).toBe(false);
    expect(hasControl("a\u007fb", "\t\n\r")).toBe(true);
  });
});
