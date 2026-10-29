import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Central } from "../src/central/central.ts";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { startServer } from "../src/server.ts";
import { newManager, poll, tempDir } from "./helpers.ts";
import { FrameClient, projectsRoot, userLine, writeTranscript } from "./history-helpers.ts";

const TOKEN = "app-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

interface Listed {
  projectKey?: string | null;
  meta?: { name: string | null; pinned: boolean; archived: boolean };
}

async function setup() {
  const { manager, store, project } = newManager();
  const root = projectsRoot();
  const history = new HistoryIndexer({ db: store.db, roots: [root] });
  const dir = tempDir();
  const configFile = join(dir, "config.json");
  writeFileSync(configFile, "{}");
  const make = () =>
    new Central({
      db: store.db,
      manager,
      hooks: { port: 0, permissionTimeoutS: 600, staleAfterS: 900 },
      dataDir: join(dir, "data"),
      hostName: "h",
      configFile,
      selfCommand: ["flightdeckd"],
      settingsPath: () => join(dir, "settings.json"),
    });
  const central = make();
  cleanups.push(() => central.stop());
  const server = startServer({
    manager,
    history,
    central,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
  });
  cleanups.push(() => server.stop());
  // One session of each kind, all in the same folder.
  const { sessionId } = manager.create({ cwd: project, prompt: "oi" });
  const managed = (await poll(() => manager.get(sessionId).claudeSessionId)) ?? "";
  mkdirSync(join(root, "-p"), { recursive: true });
  writeTranscript(root, "-p", "h1", [
    userLine({ uuid: "u1", text: "antiga", cwd: project, ts: "2026-10-01T10:00:00.000Z" }),
  ]);
  history.scan();
  central.external.apply("SessionStart", { session_id: "e1", cwd: project });
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  const lists = async () => ({
    managed: (
      await client.data<{ sessions: Array<Listed & { id: string }> }>("session.list", {})
    )?.sessions.find((s) => s.id === sessionId),
    history: (
      await client.data<{ sessions: Array<Listed & { claudeSessionId: string }> }>(
        "history.list",
        {},
      )
    )?.sessions.find((s) => s.claudeSessionId === "h1"),
    external: (
      await client.data<{ sessions: Array<Listed & { claudeSessionId: string }> }>(
        "external.list",
        {},
      )
    )?.sessions.find((s) => s.claudeSessionId === "e1"),
  });
  return { client, managed, project, lists, make };
}

const NONE = { name: null, pinned: false, archived: false };

describe("sessao-meta", () => {
  test("sem meta, as três listas trazem os padrões e o projectKey", async () => {
    const { lists, project } = await setup();
    const all = await lists();
    for (const session of [all.managed, all.history, all.external]) {
      expect(session?.meta).toEqual(NONE);
      expect(session?.projectKey).toBe(`host:h:${project}`);
    }
  });

  test("nome, fixada e arquivada persistem e voltam nas três listas", async () => {
    const { client, managed, lists } = await setup();
    const set = (payload: Record<string, unknown>) => client.request("session.meta.set", payload);
    expect((await set({ claudeSessionId: managed, name: "Gerenciada", pinned: true })).ok).toBe(
      true,
    );
    await set({ claudeSessionId: "h1", archived: true });
    await set({ claudeSessionId: "e1", name: "Do terminal" });
    await set({ claudeSessionId: "e1", pinned: true });
    const all = await lists();
    expect(all.managed?.meta).toEqual({ name: "Gerenciada", pinned: true, archived: false });
    expect(all.history?.meta).toEqual({ name: null, pinned: false, archived: true });
    expect(all.external?.meta).toEqual({ name: "Do terminal", pinned: true, archived: false });
  });

  test("set devolve a meta inteira; nome nulo limpa o nome", async () => {
    const { client } = await setup();
    await client.request("session.meta.set", { claudeSessionId: "e1", name: "x", archived: true });
    const cleared = await client.data("session.meta.set", { claudeSessionId: "e1", name: null });
    expect(cleared).toEqual({ claudeSessionId: "e1", name: null, pinned: false, archived: true });
  });
});
