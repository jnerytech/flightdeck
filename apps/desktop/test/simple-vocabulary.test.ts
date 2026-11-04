import { describe, expect, test } from "bun:test";
import { type Key, LANGS, translator } from "../src/i18n/index.ts";
import { SIMPLE_RENAMES } from "../src/i18n/simple.ts";
import { HIDDEN_TERMS, hiddenTermsIn } from "../src/lib/simple-words.ts";

describe("simple-vocabulary: the words of simple mode", () => {
  test("Given the table of renames, When a key is asked in simple mode, Then the plain word answers and full mode is untouched", () => {
    const simple = translator("en", "simple");
    const full = translator("en");
    expect(simple("sidebar.sessions")).toBe("Tasks");
    expect(full("sidebar.sessions")).toBe("Sessions");
    expect(simple("sidebar.needsYou")).toBe("Waiting for your answer");
    expect(simple("sidebar.personas")).toBe("Styles");
    expect(simple("sidebar.hosts")).toBe("Computers");
    expect(simple("sidebar.projects")).toBe("Folders");
    expect(simple("session.end")).toBe("Stop the task");
    expect(translator("pt-BR", "simple")("sidebar.sessions")).toBe("Tarefas");
    expect(translator("pt-BR", "simple")("session.end")).toBe("Parar a tarefa");
  });

  test("Given a key the table does not rename, Then simple mode answers like full mode", () => {
    expect(translator("en", "simple")("common.cancel")).toBe(translator("en")("common.cancel"));
  });

  test("Given both languages, Then they rename the same keys, and each key is a real entry with the same shape", () => {
    const keys = (lang: (typeof LANGS)[number]) => Object.keys(SIMPLE_RENAMES[lang]).sort();
    expect(keys("pt-BR")).toEqual(keys("en"));
    expect(keys("en").length).toBeGreaterThanOrEqual(8);
    for (const lang of LANGS) {
      for (const key of keys(lang)) {
        const full = translator(lang)(key as Key, { n: 1 });
        const simple = translator(lang, "simple")(key as Key, { n: 1 });
        expect(full.length).toBeGreaterThan(0);
        expect(simple.length).toBeGreaterThan(0);
        // A rename keeps the placeholders its entry takes.
        const holes = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
        expect(holes(translator(lang)(key as Key))).toEqual(
          holes(translator(lang, "simple")(key as Key)),
        );
      }
    }
  });

  test("Given every word simple mode shows, Then none of the hidden terms is in it", () => {
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(SIMPLE_RENAMES[lang])) {
        expect([key, hiddenTermsIn(String(value), lang)]).toEqual([key, []]);
      }
    }
  });

  test("Given a technical word planted in a text, Then the scan finds it, whole words only", () => {
    expect(hiddenTermsIn("Run the tool Bash in the worktree", "en").sort()).toEqual([
      "bash",
      "tool",
      "worktree",
    ]);
    expect(hiddenTermsIn("Abrir a sessão no terminal", "pt-BR").sort()).toEqual([
      "sessão",
      "terminal",
    ]);
    // A word that merely contains one is not the word.
    expect(hiddenTermsIn("The toolbox and the tokenizer", "en")).toEqual([]);
    expect(HIDDEN_TERMS.en.length).toBeGreaterThan(15);
    expect(HIDDEN_TERMS["pt-BR"].length).toBeGreaterThan(15);
  });
});
