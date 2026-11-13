import { describe, expect, test } from "bun:test";
import { HomeCache } from "../../src/features/home/domain/home-cache.ts";
import { loadChoices, UI_CHOICES_KEY } from "../../src/features/home/domain/simple-mode.ts";

const CACHE_KEY = "flightdeck.home.v1";

const planted = (key: string, value: string) => ({
  getItem: (asked: string) => (asked === key ? value : null),
  setItem: () => {},
});

describe("what Home kept on this computer is not trusted (#1609)", () => {
  test("a damaged entry of the cache is dropped and the good entries stay", () => {
    const good = { h1: { at: 5, costs: null, usage: null } };
    const cache = new HomeCache(
      planted(
        CACHE_KEY,
        JSON.stringify({
          "30d|h1": good,
          "7d|h1": null,
          "1d|h1": 7,
          "all|h1": { h1: { at: "yesterday", costs: null, usage: null }, h2: 3 },
        }),
      ),
    );
    expect(cache.get("30d|h1")).toEqual(good);
    expect(cache.get("7d|h1")).toBeUndefined();
    expect(cache.get("1d|h1")).toBeUndefined();
    expect(cache.get("all|h1")).toEqual({});
  });

  test("a cache that is not an object of entries is empty", () => {
    for (const value of ["null", "[1]", '"text"', "12", "{not json"]) {
      expect(new HomeCache(planted(CACHE_KEY, value)).get("30d|h1")).toBeUndefined();
    }
  });

  test("the mode choices keep only a host whose choice is full or simple", () => {
    const stored = JSON.stringify({ h1: "simple", h2: "full", h3: "other", h4: 1, h5: null });
    expect(loadChoices(planted(UI_CHOICES_KEY, stored))).toEqual({ h1: "simple", h2: "full" });
    for (const value of ["null", '["simple"]', "7", "{bad"]) {
      expect(loadChoices(planted(UI_CHOICES_KEY, value))).toEqual({});
    }
  });
});
