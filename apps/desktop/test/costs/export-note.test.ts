import { describe, expect, test } from "bun:test";
import { exportNote } from "../../src/features/costs/domain/costs-export-note.ts";
import { translator } from "../../src/i18n/index.ts";

// Issue #3897: what a person reads after pressing Export CSV, in both languages.
describe.each([
  [
    "en",
    {
      saved: "Saved costs-a.csv.",
      savedLeft: "Saved costs-a.csv. Left out, no file: alfa, beta.",
      nothing: "Nothing was saved: no file from alfa.",
      noHost: "Nothing was saved: no host gave a file.",
    },
  ],
  [
    "pt-BR",
    {
      saved: "Salvo costs-a.csv.",
      savedLeft: "Salvo costs-a.csv. Ficou de fora, sem arquivo: alfa, beta.",
      nothing: "Nada foi salvo: sem arquivo de alfa.",
      noHost: "Nada foi salvo: nenhum host deu arquivo.",
    },
  ],
] as const)("costs-export-note (%s)", (lang, words) => {
  const t = translator(lang);

  test("a saved file is a polite note with its name", () => {
    expect(exportNote({ kind: "saved", filename: "costs-a.csv", left: [] }, t)).toEqual({
      tone: "info",
      text: words.saved,
    });
  });

  test("a saved file with hosts left out is a warning that names them", () => {
    expect(
      exportNote({ kind: "saved", filename: "costs-a.csv", left: ["alfa", "beta"] }, t),
    ).toEqual({ tone: "warn", text: words.savedLeft });
  });

  test("nothing saved names the hosts that gave no file, as an error", () => {
    expect(exportNote({ kind: "nothing", left: ["alfa"] }, t)).toEqual({
      tone: "error",
      text: words.nothing,
    });
  });

  test("nothing saved with no host to name says no host gave a file", () => {
    expect(exportNote({ kind: "nothing", left: [] }, t)).toEqual({
      tone: "error",
      text: words.noHost,
    });
  });

  test("a cancelled save says nothing: the person chose it", () => {
    expect(exportNote({ kind: "cancelled" }, t)).toBeNull();
  });
});
