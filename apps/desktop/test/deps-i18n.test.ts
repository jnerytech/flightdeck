import { describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";

describe("deps-i18n: the wording of the dependencies agrees with what it names (HD-m6)", () => {
  test("pt-BR words do not take a gender the program does not have, and the badge reads as a sentence", () => {
    expect(ptBR.hostDeps.state.outdated).toBe("Desatualizado");
    expect(ptBR.hostDeps.without).toBe("Sem isso: {features}");
    expect(ptBR.hostDeps.badge).toBe("{host}: está faltando uma dependência obrigatória");
  });

  test("the keys nobody reads are gone from both dictionaries", () => {
    for (const dictionary of [en, ptBR]) {
      expect("title" in dictionary.hostDeps).toBe(false);
      expect("groups" in dictionary.hostDeps).toBe(false);
    }
  });
});
