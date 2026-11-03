import { describe, expect, test } from "bun:test";
import { isNewer } from "../src/lib/version.ts";

describe("atualizacao-versao: which version is newer", () => {
  test("compares the dotted numbers one by one, not as text", () => {
    expect(isNewer("0.32.1", "0.32.0")).toBe(true);
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("0.32.0", "0.32.1")).toBe(false);
    expect(isNewer("0.9.9", "0.10.0")).toBe(false);
  });

  test("the same version is not newer, and a missing part counts as zero", () => {
    expect(isNewer("0.32.0", "0.32.0")).toBe(false);
    expect(isNewer("0.32", "0.32.0")).toBe(false);
    expect(isNewer("0.32.1", "0.32")).toBe(true);
  });

  test("something that is not a version is never newer", () => {
    expect(isNewer("dev", "0.32.0")).toBe(false);
    expect(isNewer("0.32.0", "dev")).toBe(false);
    expect(isNewer("", "")).toBe(false);
  });
});
