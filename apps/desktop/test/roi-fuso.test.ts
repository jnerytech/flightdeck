import { describe, expect, test } from "bun:test";
import { memoryPlatform } from "./fixtures.ts";

const { AppStore } = await import("../src/lib/app-store.ts");

describe("roi-fuso: the hosts count ROI days in UTC", () => {
  test("late in the evening west of Greenwich the figures still end on the UTC day work was done on", () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, {
      now: () => Date.parse("2026-10-14T23:30:00Z"),
      day: () => "2026-10-13",
    });
    expect(store.today()).toBe("2026-10-13");
    expect(store.roiToday()).toBe("2026-10-14");
    store.dispose();
  });
});
