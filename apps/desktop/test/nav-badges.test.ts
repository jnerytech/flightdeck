import { describe, expect, test } from "bun:test";
import { NAV_BADGES, navBadge } from "../src/lib/nav-badges.ts";

describe("nav-badges: a badge belongs to a version range and expires on its own (issue #209)", () => {
  test("it shows before its version and is gone at it and after", () => {
    const { until } = NAV_BADGES.conversations;
    expect(navBadge("conversations", "0.36.0")).toBe("new");
    expect(navBadge("conversations", "0.37.9")).toBe("new");
    expect(navBadge("conversations", until)).toBeNull();
    expect(navBadge("conversations", "0.99.0")).toBeNull();
  });

  test("each item has its own kind and its own version", () => {
    expect(NAV_BADGES.teams.kind).toBe("beta");
    expect(NAV_BADGES.conversations.kind).toBe("new");
    expect(navBadge("teams", "0.38.5")).toBe("beta");
    expect(navBadge("teams", NAV_BADGES.teams.until)).toBeNull();
  });

  test("a release candidate counts as the version it is a candidate for", () => {
    expect(navBadge("conversations", `${NAV_BADGES.conversations.until}-rc.1`)).toBeNull();
    expect(navBadge("conversations", "0.37.0-rc.2")).toBe("new");
  });

  test("a version that is not dotted numbers keeps the badge: nothing guessed", () => {
    expect(navBadge("teams", "dev")).toBe("beta");
  });

  test("it defaults to the app's own version", () => {
    expect(navBadge("teams")).toBe("beta");
  });
});
