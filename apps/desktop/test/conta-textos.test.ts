import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";

const GLOSSARY = resolve(import.meta.dir, "../../../docs/GLOSSARY.md");

/** Every string of an object, with the path it sits at. */
function strings(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    strings(child, path ? `${path}.${key}` : key),
  );
}

describe("conta-textos: the words of the account card", () => {
  test("no text offers a Claude login: the person signs in to claude on the host", () => {
    const offers =
      /(sign|log)[ -]?in (with|to) claude|entrar com (o )?claude|login com (o )?claude|conectar com (o )?claude/i;
    const found = [...strings(en), ...strings(ptBR)].filter(([, text]) => offers.test(text));
    expect(found).toEqual([]);
  });

  test("the account texts do not use the Claude Code name or an Anthropic logo wording", () => {
    for (const dictionary of [en.account, ptBR.account]) {
      for (const [path, text] of strings(dictionary)) {
        expect(`${path}: ${/claude code|anthropic/i.test(text)}`).toBe(`${path}: false`);
      }
    }
  });

  test("the account card has the same keys in both languages", () => {
    const keys = (value: unknown) =>
      strings(value)
        .map(([path]) => path)
        .sort();
    expect(keys(en.account)).toEqual(keys(ptBR.account));
    expect(keys(en.account).length).toBeGreaterThan(20);
  });

  test("the glossary names the account and the plan window in both languages", () => {
    const text = readFileSync(GLOSSARY, "utf8");
    expect(text).toMatch(/^\| conta \| account \|/m);
    expect(text).toMatch(/^\| janela do plano \| plan window \|/m);
  });
});
