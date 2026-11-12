import { describe, expect, test } from "bun:test";
import { anyHostHas } from "../../src/lib/version.ts";

const host = (features?: string[]) => ({ hostInfo: features ? { features } : null });

describe("anyHostHas", () => {
  test("true when one host announces the feature, whatever the others do", () => {
    expect(anyHostHas([host(["costs"]), host(["teams"]), host()], "teams")).toBe(true);
  });

  test("false when no host announces it", () => {
    expect(anyHostHas([host(["costs"]), host([])], "teams")).toBe(false);
  });

  test("a host that announced nothing does not count, and no hosts is false", () => {
    expect(anyHostHas([host()], "teams")).toBe(false);
    expect(anyHostHas([{ hostInfo: { features: undefined } }], "teams")).toBe(false);
    expect(anyHostHas([], "teams")).toBe(false);
  });

  test("the feature name is matched whole, not as a prefix", () => {
    expect(anyHostHas([host(["teams.v2"])], "teams")).toBe(false);
  });
});
