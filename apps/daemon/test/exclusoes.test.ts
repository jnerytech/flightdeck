import { describe, expect, test } from "bun:test";
import { statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { EventStore } from "../src/store/event-store.ts";
import { tempDir } from "./helpers.ts";
import {
  appendRaw,
  fileRow,
  projectsRoot,
  storedMessages,
  summaryLine,
  userLine,
  writeTranscript,
} from "./history-helpers.ts";

const sessionIds = (db: EventStore["db"]) =>
  (
    db.query("SELECT claude_session_id AS id FROM history_sessions ORDER BY id").all() as Array<{
      id: string;
    }>
  ).map((r) => r.id);

describe("exclusoes", () => {
  test("sessão com cwd numa pasta excluída (ou dentro dela) não entra no índice", () => {
    const root = projectsRoot();
    const { db } = new EventStore(":memory:");
    const excluded = writeTranscript(root, "-x", "s-excluida", [
      userLine({ uuid: "u1", text: "segredo", cwd: "/home/dev/secreto" }),
    ]);
    writeTranscript(root, "-y", "s-dentro", [
      userLine({ uuid: "u1", text: "segredo também", cwd: "/home/dev/secreto/sub" }),
    ]);
    writeTranscript(root, "-z", "s-vizinha", [
      userLine({ uuid: "u1", text: "pode", cwd: "/home/dev/secreto-nao" }),
    ]);
    // The directory name never decides: only the cwd from the lines does.
    writeTranscript(root, "-home-dev-secreto", "s-nome-enganoso", [
      userLine({ uuid: "u1", text: "também pode", cwd: "/home/dev/livre" }),
    ]);
    const indexer = new HistoryIndexer({
      db,
      roots: [root],
      excludeCwds: ["/home/dev/secreto/"],
    });
    expect(
      indexer
        .scan()
        .map((r) => r.claudeSessionId)
        .sort(),
    ).toEqual(["s-nome-enganoso", "s-vizinha"]);
    expect(sessionIds(db)).toEqual(["s-nome-enganoso", "s-vizinha"]);
    expect(storedMessages(db, "s-excluida")).toEqual([]);
    expect(storedMessages(db, "s-dentro")).toEqual([]);
    // Read once and skipped, not read again on every pass.
    expect(fileRow(db, excluded)?.offset).toBe(statSync(excluded).size);
    appendRaw(excluded, `${userLine({ uuid: "u2", text: "mais", cwd: "/home/dev/secreto" })}\n`);
    expect(indexer.scan()).toEqual([]);
    expect(storedMessages(db, "s-excluida")).toEqual([]);
  });

  test("cwd que só aparece numa leitura posterior também exclui o que já tinha entrado", () => {
    const root = projectsRoot();
    const { db } = new EventStore(":memory:");
    const path = writeTranscript(root, "-p", "s-tardia", [summaryLine("só o resumo", "x")]);
    const indexer = new HistoryIndexer({ db, roots: [root], excludeCwds: ["/srv/privado"] });
    indexer.scan();
    expect(sessionIds(db)).toEqual(["s-tardia"]);
    appendRaw(path, `${userLine({ uuid: "u1", text: "agora sim", cwd: "/srv/privado/app" })}\n`);
    indexer.scan();
    expect(sessionIds(db)).toEqual([]);
    expect(storedMessages(db, "s-tardia")).toEqual([]);
  });

  test.if(process.platform === "win32")("no Windows a comparação ignora caixa e barras", () => {
    const root = projectsRoot();
    const { db } = new EventStore(":memory:");
    writeTranscript(root, "-p", "s-win", [
      userLine({ uuid: "u1", text: "x", cwd: "C:\\Users\\Dev\\Privado\\app" }),
    ]);
    const indexer = new HistoryIndexer({
      db,
      roots: [root],
      excludeCwds: ["c:/users/dev/privado"],
    });
    expect(indexer.scan()).toEqual([]);
  });

  test("config: history.roots padrão em ~/.claude/projects e ~ expandido nas exclusões", () => {
    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ history: { excludeCwds: ["~/privado", "/abs"] } }));
    const config = loadConfig(file);
    expect(config.history).toEqual({
      roots: [join(homedir(), ".claude", "projects")],
      excludeCwds: [join(homedir(), "privado"), "/abs"],
    });
    // The test home guard is on: the default root lives in the fake home.
    expect(
      config.history.roots[0]?.startsWith(process.env.USERPROFILE ?? process.env.HOME ?? ""),
    ).toBe(true);
  });
});
