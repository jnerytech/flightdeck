import { describe, expect, test } from "bun:test";
import { trimTrailingSeparators } from "../src/lib/paths.ts";

describe("paths", () => {
  test("trimTrailingSeparators drops trailing slashes and backslashes", () => {
    expect(trimTrailingSeparators("/home/me/project/")).toBe("/home/me/project");
    expect(trimTrailingSeparators("C:\\work\\project\\")).toBe("C:\\work\\project");
    expect(trimTrailingSeparators("/home/me/project//\\/")).toBe("/home/me/project");
    expect(trimTrailingSeparators("///")).toBe("");
  });

  test("trimTrailingSeparators keeps separators that are not trailing", () => {
    expect(trimTrailingSeparators("/home/me")).toBe("/home/me");
    expect(trimTrailingSeparators("")).toBe("");
    expect(trimTrailingSeparators(`${"/".repeat(50_000)}x`)).toBe(`${"/".repeat(50_000)}x`);
  });
});
