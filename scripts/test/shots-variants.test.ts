import { describe, expect, test } from "bun:test";
import { isCompleteRun, pickVariants, shotVariants } from "../lib/shots-variants.ts";

describe("shots-variants (#291)", () => {
  test("with no filter, all four pairs, light first and pt-BR before en, as the prints always ran", () => {
    expect(shotVariants({})).toEqual([
      { theme: "light", lang: "pt-BR" },
      { theme: "light", lang: "en" },
      { theme: "dark", lang: "pt-BR" },
      { theme: "dark", lang: "en" },
    ]);
  });

  test("SHOTS_THEME and SHOTS_LANG keep the pairs they name, alone or together; empty values filter nothing", () => {
    expect(shotVariants({ SHOTS_THEME: "dark", SHOTS_LANG: "en" })).toEqual([
      { theme: "dark", lang: "en" },
    ]);
    expect(shotVariants({ SHOTS_LANG: "pt-BR" })).toEqual([
      { theme: "light", lang: "pt-BR" },
      { theme: "dark", lang: "pt-BR" },
    ]);
    expect(shotVariants({ SHOTS_THEME: "", SHOTS_LANG: "" })).toHaveLength(4);
  });

  test("a filter that names no known theme or language keeps nothing, so the run can refuse it", () => {
    expect(shotVariants({ SHOTS_THEME: "blue" })).toEqual([]);
    expect(shotVariants({ SHOTS_LANG: "fr" })).toEqual([]);
  });

  test("picking refuses a filter that keeps no pair, naming it, and passes the pairs on otherwise", () => {
    expect(() => pickVariants({ SHOTS_THEME: "blue", SHOTS_LANG: "en" })).toThrow(
      "no theme and language pair matches SHOTS_THEME=blue SHOTS_LANG=en",
    );
    expect(pickVariants({ SHOTS_THEME: "dark", SHOTS_LANG: "en" })).toEqual([
      { theme: "dark", lang: "en" },
    ]);
  });

  test("a run is complete only with no filter: a CI leg prints one pair, so the other baselines are not missing", () => {
    expect(isCompleteRun({})).toBe(true);
    expect(isCompleteRun({ SHOTS_THEME: "", SHOTS_LANG: "", DEMO_SHOTS: "" })).toBe(true);
    expect(isCompleteRun({ SHOTS_THEME: "dark" })).toBe(false);
    expect(isCompleteRun({ SHOTS_LANG: "en" })).toBe(false);
    expect(isCompleteRun({ DEMO_SHOTS: "Board" })).toBe(false);
  });
});
