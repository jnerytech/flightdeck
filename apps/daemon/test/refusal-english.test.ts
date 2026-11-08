import { describe, expect, test } from "bun:test";

/**
 * Issue #957 widens it to the folders `updates/`, `plugins/` and `runenv/`.
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

/** The folders of #957: every `.ts` file in them is read, so a new file is covered at once. */
const FOLDERS = ["../src/updates", "../src/plugins", "../src/runenv"];

/** Words that only a Portuguese sentence has in a refusal (found by reading the files). */
const PORTUGUESE =
  /\b(informe|inválid[oa]|não|desligado|indisponível|pede|alvo|ou|erro interno|um dos dois|podem|neste|sessão|lançamento|demais|repetid[oa]|recusou|recusado|gerenciador|parado|porta|nome|valor|arquivos?|falhou|devolveu|respondeu|baixar|obrigatório|campo|código|raiz)\b|[ãõçáéíóúâêô]/i;

/**
 * Daemon text the app shows to the person as it is, not through the dictionaries: translating it
 * changed what they see, so it stays Portuguese until it gets a refusal code and a dictionary entry.
 * One fragment per string, per file; the detector above still covers every other string.
 */
const SHOWN_TO_THE_PERSON: Array<{ file: string; fragment: string }> = [
  { file: "plugins/inventory.ts", fragment: ": caminho fora do plugin: " },
  {
    file: "plugins/plugins.ts",
    fragment: "é diferente do que foi mostrado; o plugin foi removido",
  },
  { file: "runenv/config.ts", fragment: "precisa ser uma lista de textos" },
  { file: "runenv/manager.ts", fragment: "o setup falhou (código " },
];

/** The quoted strings on the code lines of a file (comment lines left out); templates only on request. */
function strings(source: string, templates = false): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  source.split("\n").forEach((code, index) => {
    const trimmed = code.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    for (const match of code.matchAll(/"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      if (match[1] !== undefined) found.push({ line: index + 1, text: match[1] });
      else if (templates) found.push({ line: index + 1, text: match[2] ?? "" });
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

  test("the files of updates/, plugins/ and runenv/ have no Portuguese refusal text (#957)", async () => {
    const portuguese: string[] = [];
    for (const folder of FOLDERS) {
      const dir = new URL(`${folder}/`, import.meta.url).pathname;
      for await (const name of new Bun.Glob("*.ts").scan(dir)) {
        const source = await Bun.file(`${dir}${name}`).text();
        for (const { line, text } of strings(source, true)) {
          const shown = SHOWN_TO_THE_PERSON.some(
            (item) => `${folder}/${name}`.endsWith(`/${item.file}`) && text.includes(item.fragment),
          );
          if (shown) continue;
          if (PORTUGUESE.test(text)) portuguese.push(`${folder}/${name}:${line}: ${text}`);
        }
      }
    }
    expect(portuguese.sort()).toEqual([]);
  });

  test("the detector sees a Portuguese refusal and lets an English one pass", () => {
    const sample = [
      'throw new Error("terminal desligado neste host");',
      'x("the terminal is off");',
      "y(`o manifesto ${version} tem binário`);",
      "z(`the manifest ${version} has no binary`);",
    ];
    const hits = strings(sample.join("\n"), true).filter(({ text }) => PORTUGUESE.test(text));
    expect(hits.map((h) => h.text)).toEqual([
      "terminal desligado neste host",
      "o manifesto ${version} tem binário",
    ]);
  });
});

/** Issue #957 (english-msgs2): the files and folders whose refusal, log and error text is English. */
const MSGS2_FILES = ["../src/mcp.ts", "../src/vault/rules.ts"];
const MSGS2_FOLDERS = ["../src/messaging", "../src/issues", "../src/automations"];

/** Words and letters that only a Portuguese sentence has (found by reading the files above). */
const MSGS2_PORTUGUESE =
  /\b(não|sem|uma|pelo|pela|dos|das|são|está|já|nos|deste|desta|neste|esta|este|aos|porque|quando|vale|pede|padrão|regra|janela|limite|mensagem|mensagens|projeto|aprovação|sessão|sessões|enviado|encerrada|resposta|consegui|conectar|cada|uso|erro|falhou|busca|rótulo|agendamento|automação|automações|execuções|parado|autor|externo|terceiro|terceiros|conteúdo|remoto|integração|repositório|inválido|existe|encontrada|conhecido|repassou|reiniciou|pausado|laço|atravessam|objeto|lista|texto|inteiro|seletor|obrigatório|repetido|desconhecido|vazia|acima|hora|dia|por|falharam|estado|inicia|roda|esse|confiado)\b|[ãõçáéíóúâêô]/i;

/** The quoted and template strings on the code lines of a source (comment lines left out). */
function quoted(source: string): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  source.split("\n").forEach((code, index) => {
    const trimmed = code.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    for (const match of code.matchAll(/"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      found.push({ line: index + 1, text: match[1] ?? match[2] ?? "" });
    }
  });
  return found;
}

describe("refusal-english: mcp, the vault rules, messaging, issues and automations (#957)", () => {
  test.each(MSGS2_FILES)("%s has no Portuguese text", async (file) => {
    const source = await Bun.file(new URL(file, import.meta.url)).text();
    const portuguese = quoted(source)
      .filter(({ text }) => MSGS2_PORTUGUESE.test(text))
      .map(({ line, text }) => `${line}: ${text}`);
    expect(portuguese).toEqual([]);
  });

  test("the files of messaging/, issues/ and automations/ have no Portuguese text", async () => {
    const portuguese: string[] = [];
    for (const folder of MSGS2_FOLDERS) {
      const dir = new URL(`${folder}/`, import.meta.url).pathname;
      for await (const name of new Bun.Glob("*.ts").scan(dir)) {
        const source = await Bun.file(`${dir}${name}`).text();
        for (const { line, text } of quoted(source)) {
          if (MSGS2_PORTUGUESE.test(text)) portuguese.push(`${folder}/${name}:${line}: ${text}`);
        }
      }
    }
    expect(portuguese.sort()).toEqual([]);
  });

  test("the detector sees Portuguese text in a string or a template and lets English pass", () => {
    const sample = [
      'throw new Error("a sessão terminou");',
      "refuse(`sessão s1 não encontrada`);",
      'x("the session has ended");',
      "y(`session s1 not found`);",
    ];
    const hits = quoted(sample.join("\n")).filter(({ text }) => MSGS2_PORTUGUESE.test(text));
    expect(hits.map((h) => h.text)).toEqual(["a sessão terminou", "sessão s1 não encontrada"]);
  });
});
