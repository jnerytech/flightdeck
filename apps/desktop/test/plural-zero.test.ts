import { describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";

type Leaf = { one: string; other: string };

/** Every plural leaf of a dictionary, with its dotted key. */
function plurals(node: unknown, prefix = ""): [string, Leaf][] {
  if (typeof node !== "object" || node === null) return [];
  const record = node as Record<string, unknown>;
  if (typeof record.one === "string" && typeof record.other === "string") {
    return [[prefix, record as unknown as Leaf]];
  }
  return Object.entries(record).flatMap(([k, v]) => plurals(v, prefix ? `${prefix}.${k}` : k));
}

describe("plural-zero", () => {
  for (const [lang, dictionary] of [
    ["pt-BR", ptBR],
    ["en", en],
  ] as const) {
    const t = translator(lang);
    const leaves = plurals(dictionary);

    test(`${lang}: there are plural strings to check`, () => {
      expect(leaves.length).toBeGreaterThan(5);
    });

    test(`${lang}: zero takes the plural form, one the singular, two the plural`, () => {
      for (const [key, leaf] of leaves) {
        // biome-ignore lint/suspicious/noExplicitAny: the key comes from walking the dictionary
        const say = (n: number) => t(key as any, { n });
        const fill = (text: string, n: number) => text.replace(/\{n\}/g, String(n));
        expect([key, say(0)]).toEqual([key, fill(leaf.other, 0)]);
        expect([key, say(1)]).toEqual([key, fill(leaf.one, 1)]);
        expect([key, say(2)]).toEqual([key, fill(leaf.other, 2)]);
      }
    });
  }

  test("the project card's live count reads right at zero", () => {
    expect(translator("pt-BR")("projectsOverview.live", { n: 0 })).toBe("0 sessões ativas");
  });
});
