import { describe, expect, test } from "bun:test";

/**
 * Issue #940: the raw text of a refusal goes to the app's log (the person sees the dictionary text
 * picked by the refusal's reason). New text in the codebase is English, and a Portuguese refusal
 * showed up in an English app's log. This reads the files that word those refusals and fails on a
 * quoted string that reads as Portuguese.
 */
const FILES = [
  "../../../packages/protocol/src/index.ts",
  "../src/server.ts",
  "../src/terminal/terminal-manager.ts",
];

/** Words that only a Portuguese sentence has in a refusal (found by reading the three files). */
const PORTUGUESE =
  /\b(informe|inválid[oa]|não|desligado|indisponível|pede|alvo|ou|erro interno|um dos dois|podem|neste|sessão|lançamento)\b/i;

/** The double-quoted strings on the code lines of a file (comment lines left out). */
function strings(source: string): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  source.split("\n").forEach((code, index) => {
    const trimmed = code.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    for (const match of code.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      found.push({ line: index + 1, text: match[1] ?? "" });
    }
  });
  return found;
}

describe("refusal-english: the raw text of a refusal is English (#940)", () => {
  test.each(FILES)("%s has no Portuguese refusal text", async (file) => {
    const source = await Bun.file(new URL(file, import.meta.url)).text();
    const portuguese = strings(source)
      .filter(({ text }) => PORTUGUESE.test(text))
      .map(({ line, text }) => `${line}: ${text}`);
    expect(portuguese).toEqual([]);
  });

  test("the detector sees a Portuguese refusal and lets an English one pass", () => {
    const sample = [
      'throw new Error("terminal desligado neste host");',
      'x("the terminal is off");',
    ];
    const hits = strings(sample.join("\n")).filter(({ text }) => PORTUGUESE.test(text));
    expect(hits.map((h) => h.text)).toEqual(["terminal desligado neste host"]);
  });
});
