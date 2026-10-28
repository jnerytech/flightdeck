import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { EventStore } from "../src/store/event-store.ts";
import { assistantLine, projectsRoot, userLine, writeTranscript } from "./history-helpers.ts";

const A = "/home/dev/a";
const B = "/home/dev/b";

/** Two projects (plus a subfolder and a look-alike), with text that must not be searchable. */
function setup(fts5: boolean) {
  const root = projectsRoot();
  const store = new EventStore(":memory:");
  const logs: string[] = [];
  const pathA = writeTranscript(root, "-a", "sess-a", [
    userLine({
      uuid: "a1",
      text: "Onde mora o flamingo azul?",
      cwd: A,
      ts: "2026-09-01T10:00:00.000Z",
    }),
    assistantLine({
      uuid: "a2",
      text: "Ele mora no lago.",
      cwd: A,
      ts: "2026-09-01T10:00:01.000Z",
    }),
    JSON.stringify({
      type: "user",
      cwd: A,
      uuid: "a3",
      timestamp: "2026-09-01T10:00:02.000Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", content: "flamingo no resultado" }],
      },
    }),
    JSON.stringify({ type: "queue-operation", cwd: A, uuid: "a4", note: "flamingo cru" }),
  ]);
  writeTranscript(root, "-b", "sess-b", [
    userLine({
      uuid: "b1",
      text: "Pinte o flamingo de verde",
      cwd: B,
      ts: "2026-09-10T08:00:00.000Z",
    }),
  ]);
  writeTranscript(root, "-a-sub", "sess-sub", [
    userLine({
      uuid: "s1",
      text: "flamingo da subpasta",
      cwd: `${A}/sub`,
      ts: "2026-09-05T08:00:00.000Z",
    }),
  ]);
  writeTranscript(root, "-ab", "sess-ab", [
    userLine({
      uuid: "x1",
      text: "flamingo vizinho",
      cwd: `${A}b`,
      ts: "2026-09-06T08:00:00.000Z",
    }),
  ]);
  const indexer = new HistoryIndexer({
    db: store.db,
    roots: [root],
    fts5,
    log: (m) => logs.push(m),
  });
  indexer.scan();
  return { indexer, logs, pathA, store };
}

const ids = (hits: { uuid: string }[]) => hits.map((h) => h.uuid);

describe("busca", () => {
  for (const fts5 of [true, false]) {
    const mode = fts5 ? "FTS5" : "LIKE";

    test(`${mode}: termo presente acha a mensagem certa, com trecho destacado`, () => {
      const { indexer } = setup(fts5);
      expect(indexer.fts).toBe(fts5);
      const hits = indexer.search({ query: "azul" });
      expect(hits).toEqual([
        {
          claudeSessionId: "sess-a",
          uuid: "a1",
          ts: "2026-09-01T10:00:00.000Z",
          cwd: A,
          title: "Onde mora o flamingo azul?",
          role: "user",
          snippet: "Onde mora o flamingo «azul»?",
        },
      ]);
      // Several terms: all of them must be present.
      expect(ids(indexer.search({ query: "mora lago" }))).toEqual(["a2"]);
      expect(ids(indexer.search({ query: "inexistente" }))).toEqual([]);
      expect(indexer.search({ query: "   " })).toEqual([]);
    });

    test(`${mode}: mais recentes primeiro; resultados de ferramenta e linhas cruas não entram`, () => {
      const { indexer } = setup(fts5);
      expect(ids(indexer.search({ query: "flamingo" }))).toEqual(["b1", "x1", "s1", "a1"]);
      expect(ids(indexer.search({ query: "resultado" }))).toEqual([]);
      expect(ids(indexer.search({ query: "cru" }))).toEqual([]);
      expect(ids(indexer.search({ query: "flamingo", limit: 2 }))).toEqual(["b1", "x1"]);
    });

    test(`${mode}: filtros de pasta e de período`, () => {
      const { indexer } = setup(fts5);
      // The folder itself and anything below it, never a look-alike prefix.
      expect(ids(indexer.search({ query: "flamingo", cwd: A }))).toEqual(["s1", "a1"]);
      expect(ids(indexer.search({ query: "flamingo", cwd: `${A}/` }))).toEqual(["s1", "a1"]);
      expect(ids(indexer.search({ query: "flamingo", from: "2026-09-05T00:00:00.000Z" }))).toEqual([
        "b1",
        "x1",
        "s1",
      ]);
      expect(
        ids(
          indexer.search({
            query: "flamingo",
            from: "2026-09-02T00:00:00.000Z",
            to: "2026-09-05T23:59:59.999Z",
          }),
        ),
      ).toEqual(["s1"]);
    });

    test(`${mode}: texto apagado por truncamento some da busca; aspas e símbolos não quebram`, () => {
      const { indexer, pathA } = setup(fts5);
      writeFileSync(pathA, `${userLine({ uuid: "n1", text: "conteúdo novo", cwd: A })}\n`);
      indexer.scan();
      expect(ids(indexer.search({ query: "azul" }))).toEqual([]);
      expect(ids(indexer.search({ query: "novo" }))).toEqual(["n1"]);
      expect(() => indexer.search({ query: 'flamingo" OR -x*' })).not.toThrow();
    });
  }

  test("o trecho é cortado em volta do acerto em textos longos", () => {
    const root = projectsRoot();
    const store = new EventStore(":memory:");
    const long = `${"antes ".repeat(40)}agulha${" depois".repeat(40)}`;
    writeTranscript(root, "-l", "longa", [userLine({ uuid: "l1", text: long, cwd: "/l" })]);
    const indexer = new HistoryIndexer({ db: store.db, roots: [root], fts5: false });
    indexer.scan();
    const snippet = indexer.search({ query: "agulha" })[0]?.snippet ?? "";
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("«agulha»");
    expect(snippet.length).toBeLessThan(200);
  });

  test("sem a flag o daemon detecta o FTS5 e registra a decisão", () => {
    const store = new EventStore(":memory:");
    const logs: string[] = [];
    const detected = new HistoryIndexer({ db: store.db, roots: [], log: (m) => logs.push(m) });
    // The SQLite bundled with Bun has FTS5.
    expect(detected.fts).toBe(true);
    new HistoryIndexer({ db: store.db, roots: [], fts5: false, log: (m) => logs.push(m) });
    expect(logs).toEqual([
      "histórico: busca com FTS5",
      "histórico: FTS5 indisponível, busca com LIKE",
    ]);
  });
});
