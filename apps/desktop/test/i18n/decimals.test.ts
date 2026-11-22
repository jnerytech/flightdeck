import { describe, expect, test } from "bun:test";
import { EMPTY_PERIOD, figures } from "../../src/features/roi/domain/roi.ts";
import { budgetLines } from "../../src/features/runenv/domain/runs.ts";
import { formatMs } from "../../src/features/sessions/index.ts";
import { formatDecimal, formatSeconds } from "../../src/i18n/format.ts";
import { translator } from "../../src/i18n/index.ts";

// #3853: a decimal a person reads follows the language, so pt-BR never shows a point beside a
// comma ("US$ 0,02" next to "41.0 s").
describe("the decimals of the app follow the language (#3853)", () => {
  test("one decimal: a point in English, a comma in Portuguese, and always one digit", () => {
    expect([formatDecimal(1.5, "en"), formatDecimal(1.5, "pt-BR")]).toEqual(["1.5", "1,5"]);
    expect([formatDecimal(41, "en"), formatDecimal(41, "pt-BR")]).toEqual(["41.0", "41,0"]);
    expect(formatDecimal(1234.56, "pt-BR")).toBe("1.234,6");
  });

  test("a time under a minute reads 1.5 s in English and 1,5 s in Portuguese, from every formatter", () => {
    for (const [lang, text] of [
      ["en", "1.5 s"],
      ["pt-BR", "1,5 s"],
    ] as const) {
      expect(formatMs(1500, translator(lang))).toBe(text);
      expect(formatSeconds(1500, lang, translator(lang))).toBe(text);
    }
  });

  test("under a second it stays in milliseconds, and from a minute on it is a duration", () => {
    expect(formatMs(150, translator("pt-BR"))).toBe("150 ms");
    expect(formatMs(61_000, translator("pt-BR"))).not.toContain(",");
  });

  test("the minutes of a run against its budget use the language's decimal", () => {
    const run = {
      usage: { turns: 1, minutes: 1.5, costUsd: 0 },
      budget: { maxMinutes: 10 },
    } as never;
    const minutes = (lang: "en" | "pt-BR") => budgetLines(run, translator(lang))[1]?.text ?? "";
    expect(minutes("en")).toContain("1.5");
    expect(minutes("pt-BR")).toContain("1,5");
  });

  test("the return on cost in the derivation uses the language's decimal", () => {
    const period = { ...EMPTY_PERIOD, costUsd: 12, cards: 3, hours: 6 };
    const money = { rate: 60, billed: 0 } as never;
    const roi = (lang: "en" | "pt-BR") =>
      figures(period, money, lang).derivation.find((line) => line.key === "roiUi.derive.roi")?.vars
        ?.roi;
    expect([roi("en"), roi("pt-BR")]).toEqual(["29.0×", "29,0×"]);
  });
});
