import { describe, expect, test } from "bun:test";
import { visibleTsLiterals } from "../../../scripts/lib/i18n-sweep.ts";

const SOURCE = [
  'const a = { label: "Abrir", detail: `${x} · ação`, id: "open" };',
  'throw new Error("sem resposta");',
  '// label: "Comentário"',
  "this.fail(error, `Terminal não abriu: ${e}`);",
  'const lista = ["histórico"];',
  'const b = { label: "OK", text: "", title: `${a}` };',
  "export const C = { body: `${host}: ${what} em ${n}% de ${limit}` };",
  'const c = { label: "Flightdeck" };',
  'const d = { notice: "Este link veio de fora do app. Confira os dados antes de salvar." };',
  'throw new Error("connection lost");',
  'throw new RequestError("offline", "host desconhecido");',
].join("\n");

describe("textos-ts", () => {
  test("um erro lançado em português também conta: ele chega à tela como detalhe de uma recusa", () => {
    const texts = visibleTsLiterals(SOURCE, ["Flightdeck"]).map((l) => l.text);
    expect(texts).toContain("sem resposta");
  });

  test("acha o texto visível em .ts: valores de label, title, detail…, mensagens de fail e textos com acento", () => {
    expect(visibleTsLiterals(SOURCE, ["Flightdeck"])).toEqual([
      { line: 1, text: "Abrir" },
      { line: 1, text: "· ação" },
      { line: 2, text: "sem resposta" },
      { line: 4, text: "Terminal não abriu:" },
      { line: 5, text: "histórico" },
      { line: 6, text: "OK" },
      { line: 7, text: ": em % de" },
      { line: 9, text: "Este link veio de fora do app. Confira os dados antes de salvar." },
      { line: 11, text: "host desconhecido" },
    ]);
  });

  test("o que está permitido, os erros técnicos em inglês, os comentários e os textos sem letras não contam", () => {
    expect(visibleTsLiterals(SOURCE).map((l) => l.text)).toContain("Flightdeck");
    expect(visibleTsLiterals(SOURCE, ["Flightdeck"]).map((l) => l.text)).not.toContain(
      "Flightdeck",
    );
    const texts = visibleTsLiterals(SOURCE, ["Flightdeck"]).map((l) => l.text);
    expect(texts).not.toContain("Comentário");
    expect(texts).not.toContain("connection lost");
  });
});
