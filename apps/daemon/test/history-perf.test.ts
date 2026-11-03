import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Central } from "../src/central/central.ts";
import { ProjectKeys } from "../src/central/project-key.ts";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient, projectsRoot, userLine, writeTranscript } from "./history-helpers.ts";

const TOKEN = "history-perf-token-0123456";
const FOLDERS = 12;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Project keys whose git runners only count: a blocking call stalls the daemon's event loop. */
function countingKeys() {
  const calls = { blocking: 0, async: 0 };
  const keys = new ProjectKeys(
    "h",
    () => {
      calls.blocking++;
      return { code: 128, stdout: "", stderr: "" };
    },
    async () => {
      calls.async++;
      return { code: 128, stdout: "", stderr: "" };
    },
  );
  return { keys, calls };
}

async function app(url: string): Promise<FrameClient> {
  const client = new FrameClient(url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return client;
}

function central(keys: ProjectKeys, manager: ReturnType<typeof newManager>["manager"]) {
  const dir = tempDir("fd-hperf-");
  const configFile = join(dir, "config.json");
  writeFileSync(configFile, "{}");
  const hub = new Central({
    db: new EventStore(":memory:").db,
    manager,
    hooks: { port: 0, permissionTimeoutS: 600, staleAfterS: 900 },
    dataDir: join(dir, "data"),
    hostName: "h",
    configFile,
    selfCommand: ["flightdeckd"],
    settingsPath: () => join(dir, "settings.json"),
    keys,
  });
  cleanups.push(() => hub.stop());
  return hub;
}

describe("history-perf: the lists never block the event loop on git", () => {
  test("history.list resolves the keys of a cold page without a blocking git call", async () => {
    const root = projectsRoot();
    for (let i = 0; i < FOLDERS; i++) {
      const cwd = `/work/folder-${i}`;
      writeTranscript(root, `-f${i}`, `s-${i}`, [
        userLine({ uuid: `u${i}`, text: "hi", cwd, ts: `2026-09-01T10:00:${10 + i}.000Z` }),
      ]);
    }
    const index = new HistoryIndexer({ db: new EventStore(":memory:").db, roots: [root] });
    cleanups.push(() => index.stop());
    index.scan();
    const { keys, calls } = countingKeys();
    const { manager } = newManager();
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
      history: index,
      central: central(keys, manager),
      warmProjectKey: (cwd) => keys.resolve(cwd),
    });
    cleanups.push(() => server.stop());
    const client = await app(server.url);
    const page = await client.data<{ sessions: Array<{ projectKey?: string }> }>(
      "history.list",
      {},
    );
    expect(page?.sessions.length).toBe(FOLDERS);
    expect(page?.sessions.every((s) => s.projectKey?.startsWith("host:h:"))).toBe(true);
    expect(calls.blocking).toBe(0);
    expect(calls.async).toBe(FOLDERS);
  });

  test("session.list resolves the keys of cold managed sessions without a blocking git call", async () => {
    const { manager, root } = newManager();
    for (let i = 0; i < FOLDERS; i++) {
      const cwd = join(root, `folder-${i}`);
      mkdirSync(cwd);
      manager.create({ cwd, prompt: "hi" });
    }
    const { keys, calls } = countingKeys();
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
      central: central(keys, manager),
      warmProjectKey: (cwd) => keys.resolve(cwd),
    });
    cleanups.push(() => server.stop());
    const client = await app(server.url);
    const data = await client.data<{ sessions: unknown[] }>("session.list", {});
    expect(data?.sessions.length).toBe(FOLDERS);
    expect(calls.blocking).toBe(0);
    expect(calls.async).toBe(FOLDERS);
  });
});
