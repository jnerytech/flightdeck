import { describe, expect, test } from "bun:test";
import { closeSync, openSync, statSync, writeSync } from "node:fs";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { EventStore } from "../src/store/event-store.ts";
import {
  appendRaw,
  assistantLine,
  fileRow,
  projectsRoot,
  storedMessages,
  userLine,
  writeTranscript,
} from "./history-helpers.ts";

const ID = "33333333-3333-4333-8333-333333333333";
const CWD = "/home/dev/projeto-inc";

function setup() {
  const root = projectsRoot();
  const store = new EventStore(":memory:");
  const indexer = new HistoryIndexer({ db: store.db, roots: [root] });
  return { root, db: store.db, indexer };
}

describe("incremental", () => {
  test("acrescentar linhas indexa só as novas, a partir do offset salvo", () => {
    const { root, db, indexer } = setup();
    const first = userLine({ uuid: "u1", text: "Primeira pergunta", cwd: CWD });
    const path = writeTranscript(root, "-home-dev-projeto-inc", ID, [
      first,
      assistantLine({ uuid: "a1", text: "Primeira resposta", cwd: CWD }),
    ]);
    expect(indexer.scan().map((r) => [r.claudeSessionId, r.added])).toEqual([[ID, 2]]);
    expect(fileRow(db, path)?.offset).toBe(statSync(path).size);

    // Rewrite bytes already read (same length): a pass that reread from 0 would pick this up.
    const fd = openSync(path, "r+");
    writeSync(fd, Buffer.from("X"), 0, 1, first.indexOf("Primeira"));
    closeSync(fd);
    appendRaw(
      path,
      `${userLine({ uuid: "u2", text: "Segunda com ação 😀", cwd: CWD })}\r\n${assistantLine({ uuid: "a2", text: "ok", cwd: CWD })}\n`,
    );
    expect(indexer.scan().map((r) => [r.claudeSessionId, r.added, r.reset])).toEqual([
      [ID, 2, false],
    ]);
    expect(storedMessages(db, ID).map((m) => m.text)).toEqual([
      "Primeira pergunta",
      "Primeira resposta",
      "Segunda com ação 😀",
      "ok",
    ]);
    // Offsets are bytes, multibyte text and CRLF included.
    expect(fileRow(db, path)?.offset).toBe(statSync(path).size);
    // Nothing new: nothing read.
    expect(indexer.scan()).toEqual([]);
  });

  test("uma última linha sem quebra final espera a próxima leitura", () => {
    const { root, db, indexer } = setup();
    const path = writeTranscript(root, "-p", ID, [
      userLine({ uuid: "u1", text: "completa", cwd: CWD }),
    ]);
    indexer.scan();
    const before = fileRow(db, path)?.offset ?? -1;

    const partial = assistantLine({ uuid: "a1", text: "meio escrita", cwd: CWD });
    appendRaw(path, partial.slice(0, 20));
    expect(indexer.scan()).toEqual([]);
    expect(fileRow(db, path)?.offset).toBe(before);
    expect(fileRow(db, path)?.parse_errors).toBe(0);
    expect(storedMessages(db, ID).map((m) => m.uuid)).toEqual(["u1"]);

    appendRaw(path, `${partial.slice(20)}\n`);
    expect(indexer.scan().map((r) => r.added)).toEqual([1]);
    expect(storedMessages(db, ID).map((m) => [m.uuid, m.text])).toEqual([
      ["u1", "completa"],
      ["a1", "meio escrita"],
    ]);
    expect(fileRow(db, path)?.offset).toBe(statSync(path).size);
  });

  test("linhas inválidas são contadas no arquivo; vários projetos e raízes", () => {
    const { root, db } = setup();
    const other = projectsRoot();
    const first = writeTranscript(root, "-a", "aaaa", [
      userLine({ uuid: "u1", text: "um", cwd: "/a" }),
      "não é json",
    ]);
    writeTranscript(root, "-b", "bbbb", [userLine({ uuid: "u1", text: "dois", cwd: "/b" })]);
    writeTranscript(other, "-c", "cccc", [userLine({ uuid: "u1", text: "três", cwd: "/c" })]);
    const indexer = new HistoryIndexer({ db, roots: [root, other, `${root}-inexistente`] });
    const ids = indexer
      .scan()
      .map((r) => r.claudeSessionId)
      .sort();
    expect(ids).toEqual(["aaaa", "bbbb", "cccc"]);
    expect(fileRow(db, first)?.parse_errors).toBe(1);
  });
});
