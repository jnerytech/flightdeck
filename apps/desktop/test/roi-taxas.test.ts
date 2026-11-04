import { describe, expect, test } from "bun:test";
import { ROI_KEY, RoiSettings } from "../src/lib/roi-settings.ts";

function setup() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  let n = 0;
  const make = () => new RoiSettings({ storage }, { newId: () => `id${++n}` });
  return { store, make, settings: make() };
}

describe("roi-taxas: rates, the plan price and the review switch", () => {
  test("nothing is set at first: no rate, no price, review time off with a five minute cap", () => {
    expect(setup().settings.data()).toEqual({
      v: 1,
      defaultRate: null,
      clientRates: {},
      projectRates: {},
      planPrice: null,
      countReview: false,
      reviewCapMinutes: 5,
      people: [],
    });
  });

  test("a project's own rate wins over its client's, which wins over the app's", () => {
    const { settings } = setup();
    expect(settings.rateFor("acme/shop", "c1")).toBeNull();
    settings.setDefaultRate(40);
    expect(settings.rateFor("acme/shop", "c1")).toBe(40);
    settings.setClientRate("c1", 60);
    expect(settings.rateFor("acme/shop", "c1")).toBe(60);
    expect(settings.rateFor("acme/shop", null)).toBe(40);
    settings.setProjectRate("acme/shop", 90);
    expect(settings.rateFor("acme/shop", "c1")).toBe(90);
    expect(settings.rateFor("acme/blog", "c1")).toBe(60);
    settings.setProjectRate("acme/shop", null);
    settings.setClientRate("c1", null);
    expect(settings.rateFor("acme/shop", "c1")).toBe(40);
  });

  test("the plan price, the review switch and its cap are kept", () => {
    const { settings } = setup();
    settings.setPlanPrice(100);
    settings.setCountReview(true);
    settings.setReviewCap(10);
    expect(settings.data()).toMatchObject({
      planPrice: 100,
      countReview: true,
      reviewCapMinutes: 10,
    });
    settings.setPlanPrice(null);
    expect(settings.data().planPrice).toBeNull();
  });

  test("a rate that is not a number from zero up, or a cap outside 1 to 60 minutes, is refused", () => {
    const { settings } = setup();
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1e9]) {
      expect(() => settings.setDefaultRate(bad)).toThrow();
      expect(() => settings.setClientRate("c", bad)).toThrow();
      expect(() => settings.setProjectRate("k", bad)).toThrow();
      expect(() => settings.setPlanPrice(bad)).toThrow();
    }
    expect(() => settings.setReviewCap(0)).toThrow();
    expect(() => settings.setReviewCap(61)).toThrow();
    expect(settings.data().defaultRate).toBeNull();
  });

  test("they persist, and a corrupt store reads as nothing set", () => {
    const { store, make, settings } = setup();
    settings.setDefaultRate(55);
    settings.setClientRate("c1", 70);
    expect(make().data()).toMatchObject({ defaultRate: 55, clientRates: { c1: 70 } });
    store.set(ROI_KEY, "{not json");
    expect(make().data().defaultRate).toBeNull();
  });

  test("an export keeps the rates and an import restores them, and refuses anything else", () => {
    const a = setup();
    a.settings.setDefaultRate(55);
    a.settings.setClientRate("c1", 70);
    a.settings.setProjectRate("acme/shop", 80);
    a.settings.setPlanPrice(100);
    a.settings.setCountReview(true);
    const text = a.settings.exportJson();
    const b = setup();
    expect(b.settings.importJson(text)).toEqual({ people: 0 });
    expect(b.settings.data()).toEqual(a.settings.data());
    expect(b.settings.importJson("nonsense")).toBeNull();
    expect(b.settings.importJson(JSON.stringify({ v: 1, hello: true }))).toBeNull();
    expect(b.settings.data()).toEqual(a.settings.data());
  });
});
