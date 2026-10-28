import { describe, expect, test } from "bun:test";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, poll } from "./helpers.ts";
import { appendRaw, projectsRoot, userLine, writeTranscript } from "./history-helpers.ts";

const origins = (db: EventStore["db"]) =>
  Object.fromEntries(
    (
      db.query("SELECT claude_session_id AS id, origin FROM history_sessions").all() as Array<{
        id: string;
        origin: string;
      }>
    ).map((r) => [r.id, r.origin]),
  );

describe("origem", () => {
  test("transcript de uma sessão gerenciada recebe origem flightdeck; os outros external", async () => {
    const { manager, store, project } = newManager();
    const { sessionId } = manager.create({ cwd: project, prompt: "oi" });
    const managed = await poll(() => manager.get(sessionId).claudeSessionId);
    expect(managed).not.toBeNull();

    const root = projectsRoot();
    writeTranscript(root, "-p", managed ?? "", [
      userLine({ uuid: "u1", text: "oi", cwd: project }),
    ]);
    writeTranscript(root, "-t", "de-fora", [userLine({ uuid: "u1", text: "x", cwd: "/t" })]);
    new HistoryIndexer({ db: store.db, roots: [root] }).scan();
    expect(origins(store.db)).toEqual({ [managed ?? ""]: "flightdeck", "de-fora": "external" });
  });

  test("transcript indexado antes do session.init passa a flightdeck na próxima varredura", () => {
    const store = new EventStore(":memory:");
    const root = projectsRoot();
    const path = writeTranscript(root, "-p", "cedo", [
      userLine({ uuid: "u1", text: "x", cwd: "/p" }),
    ]);
    const indexer = new HistoryIndexer({ db: store.db, roots: [root] });
    indexer.scan();
    expect(origins(store.db)).toEqual({ cedo: "external" });

    store.createSession({
      id: "S1",
      name: null,
      cwd: "/p",
      status: "running",
      permissionMode: "default",
      model: null,
    });
    store.updateSession("S1", { claudeSessionId: "cedo" });
    // No new bytes in the file: the pass still refreshes the origin.
    expect(indexer.scan()).toEqual([]);
    expect(origins(store.db)).toEqual({ cedo: "flightdeck" });

    // And new lines keep it.
    appendRaw(path, `${userLine({ uuid: "u2", text: "y", cwd: "/p" })}\n`);
    indexer.scan();
    expect(origins(store.db)).toEqual({ cedo: "flightdeck" });
  });
});
