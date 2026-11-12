import { describe, expect, test } from "bun:test";
import { hostsWith } from "../../src/lib/version.ts";

const host = (id: string, status: string, features?: string[]) => ({
  id,
  status,
  hostInfo: features ? { features } : null,
});

describe("hostsWith", () => {
  test("keeps the online hosts that announce the feature, in order", () => {
    const hosts = [
      host("a", "online", ["costs", "teams"]),
      host("b", "online", ["teams"]),
      host("c", "online", ["costs"]),
    ];
    expect(hostsWith(hosts, "costs").map((h) => h.id)).toEqual(["a", "c"]);
  });

  test("a host that is not online is left out even when it announces the feature", () => {
    const hosts = [host("a", "offline", ["costs"]), host("b", "connecting", ["costs"])];
    expect(hostsWith(hosts, "costs")).toEqual([]);
  });

  test("a host that announced nothing does not count", () => {
    expect(hostsWith([host("a", "online")], "costs")).toEqual([]);
    expect(hostsWith([], "costs")).toEqual([]);
  });

  test("the feature name is matched whole, not as a prefix", () => {
    expect(hostsWith([host("a", "online", ["costs.v2"])], "costs")).toEqual([]);
  });
});
