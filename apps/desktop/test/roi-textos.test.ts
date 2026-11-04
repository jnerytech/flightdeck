import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";

type Tree = { [key: string]: string | Tree };

/** Every text of a dictionary branch, by dotted path. */
function flatten(tree: Tree, prefix = ""): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string"
      ? [[`${prefix}${key}`, value] as [string, string]]
      : flatten(value, `${prefix}${key}.`),
  );
}

const texts = {
  en: flatten(en.roiUi as unknown as Tree),
  "pt-BR": flatten(ptBR.roiUi as unknown as Tree),
};
const glossary = readFileSync(resolve(import.meta.dir, "../../../docs/GLOSSARY.md"), "utf8");

describe("roi-textos: the words of the return on cost", () => {
  test("both dictionaries have the same keys", () => {
    expect(texts["pt-BR"].map(([key]) => key).sort()).toEqual(texts.en.map(([key]) => key).sort());
  });

  test("no text says profit or savings, in either language", () => {
    for (const [lang, list] of Object.entries(texts)) {
      const banned = list.filter(([, text]) =>
        /\b(profits?|savings?|lucros?|economia|economiza\w*)\b/i.test(text),
      );
      expect({ lang, banned }).toEqual({ lang, banned: [] });
    }
  });

  test("whatever is typed, not measured, carries the word estimate wherever it is named", () => {
    const named = /(^|\.)(value|roi|hours)$/;
    const estimate = { en: /estimate/i, "pt-BR": /estimativa|estimad/i };
    for (const [lang, list] of Object.entries(texts) as Array<
      [keyof typeof texts, Array<[string, string]>]
    >) {
      const missing = list
        .filter(([key]) => named.test(key) || key === "derive.value" || key === "derive.roi")
        .filter(([, text]) => !estimate[lang].test(text))
        .map(([key]) => key);
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
  });

  test("the glossary names the new terms in both languages, as the dictionaries say them", () => {
    const rows = glossary.split("\n");
    const find = (en: string, pt: string) =>
      rows.some((r) => {
        const cells = r.split("|").map((c) => c.trim());
        return (
          cells[1]?.toLowerCase() === pt.toLowerCase() &&
          cells[2]?.toLowerCase() === en.toLowerCase()
        );
      });
    expect(find(en.roiUi.table.roi, ptBR.roiUi.table.roi)).toBe(true);
    expect(find(en.roiUi.table.value, ptBR.roiUi.table.value)).toBe(true);
    expect(find(en.roiUi.table.hours, ptBR.roiUi.table.hours)).toBe(true);
    expect(find("delivered work", "trabalho entregue")).toBe(true);
    expect(find("planned", "planejado")).toBe(true);
    expect(find("unplanned", "não planejado")).toBe(true);
    expect(find("person", "pessoa")).toBe(true);
  });
});
