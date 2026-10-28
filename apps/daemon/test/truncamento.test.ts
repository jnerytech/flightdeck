import { describe, expect, test } from "bun:test";
import { statSync, writeFileSync } from "node:fs";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { EventStore } from "../src/store/event-store.ts";
import {
  assistantLine,
  fileRow,
  projectsRoot,
  storedMessages,
  userLine,
  writeTranscript,
} from "./history-helpers.ts";

const ID = "44444444-4444-4444-8444-444444444444";
const CWD = "/home/dev/projeto-trunc";

describe("truncamento", () => {
  test("arquivo menor que o offset é reindexado do zero", () => {
    const root = projectsRoot();
    const { db } = new EventStore(":memory:");
    const indexer = new HistoryIndexer({ db, roots: [root] });
    const path = writeTranscript(root, "-p", ID, [
      userLine({ uuid: "u1", text: "antiga pergunta", cwd: CWD }),
      assistantLine({ uuid: "a1", text: "antiga resposta longa", cwd: CWD }),
      "linha inválida",
      userLine({ uuid: "u2", text: "outra antiga", cwd: CWD }),
    ]);
    indexer.scan();
    expect(fileRow(db, path)?.parse_errors).toBe(1);

    // Same file name, shorter content (truncated or swapped by another tool).
    writeFileSync(path, `${userLine({ uuid: "n1", text: "nova", cwd: CWD })}\n`);
    expect(indexer.scan().map((r) => [r.claudeSessionId, r.added, r.reset])).toEqual([
      [ID, 1, true],
    ]);
    expect(storedMessages(db, ID).map((m) => [m.uuid, m.text])).toEqual([["n1", "nova"]]);
    expect(fileRow(db, path)).toEqual({
      size: statSync(path).size,
      offset: statSync(path).size,
      parse_errors: 0,
    });
    const session = db
      .query("SELECT title, message_count FROM history_sessions WHERE claude_session_id = ?")
      .get(ID);
    expect(session).toEqual({ title: "nova", message_count: 1 });
  });

  test("arquivo esvaziado fica sem mensagens e a próxima linha entra normalmente", () => {
    const root = projectsRoot();
    const { db } = new EventStore(":memory:");
    const indexer = new HistoryIndexer({ db, roots: [root] });
    const path = writeTranscript(root, "-p", ID, [
      userLine({ uuid: "u1", text: "vai sumir", cwd: CWD }),
    ]);
    indexer.scan();
    writeFileSync(path, "");
    expect(indexer.scan().map((r) => [r.added, r.reset])).toEqual([[0, true]]);
    expect(storedMessages(db, ID)).toEqual([]);
    expect(fileRow(db, path)?.offset).toBe(0);

    writeFileSync(path, `${userLine({ uuid: "u9", text: "voltou", cwd: CWD })}\n`);
    expect(indexer.scan().map((r) => [r.added, r.reset])).toEqual([[1, false]]);
    expect(storedMessages(db, ID).map((m) => m.text)).toEqual(["voltou"]);
  });
});
