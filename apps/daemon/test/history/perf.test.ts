import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Central } from "../../src/central/central.ts";
import { ProjectKeys } from "../../src/central/project-key.ts";
import { HistoryIndexer } from "../../src/history/indexer.ts";
import { LocalEndpoints } from "../../src/messaging/endpoints.ts";
import type { Messaging } from "../../src/messaging/messages.ts";
import { startServer } from "../../src/server.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { newManager, tempDir } from "../support/helpers.ts";
import {
  FrameClient,
  projectsRoot,
  userLine,
  writeTranscript,
} from "../support/history-helpers.ts";

const TOKEN = "history-perf-token-0123456";
const FOLDERS = 12;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Project keys whose git runner only counts: one lookup per folder, however many callers ask. */
function countingKeys() {
  const calls = { async: 0 };
  const keys = new ProjectKeys("h", async () => {
    calls.async++;
    return { code: 128, stdout: "", stderr: "" };
  });
  return { keys, calls };
}

/** Project keys of a folder that is a clone of one repository: git answers, never blocks. */
function clonedKeys() {
  return new ProjectKeys("h", async (args) =>
    args.includes("rev-parse")
      ? { code: 0, stdout: `${args[args.indexOf("-C") + 1]}/.git` }
      : { code: 0, stdout: "git@github.com:Acme/Repo.git" },
  );
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
    await index.scan();
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
    expect(calls.async).toBe(FOLDERS);
  });

  test("session.list resolves the keys of cold managed sessions without a blocking git call", async () => {
    const { manager, root } = newManager();
    for (let i = 0; i < FOLDERS; i++) {
      const cwd = join(root, `folder-${i}`);
      mkdirSync(cwd);
      await manager.create({ cwd, prompt: "hi" });
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
    expect(calls.async).toBe(FOLDERS);
  });

  test("external.list reads no key through a blocking git call", async () => {
    const { manager, root } = newManager();
    const { keys, calls } = countingKeys();
    const hub = central(keys, manager);
    for (let i = 0; i < FOLDERS; i++) {
      hub.external.apply("SessionStart", { session_id: `x${i}`, cwd: join(root, `f${i}`) });
    }
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
      central: hub,
      warmProjectKey: (cwd) => keys.resolve(cwd),
    });
    cleanups.push(() => server.stop());
    const client = await app(server.url);
    const data = await client.data<{ sessions: unknown[] }>("external.list", {});
    expect(data?.sessions.length).toBe(FOLDERS);
  });

  test("a messages command resolves the keys of the cold sessions it lists without a blocking git call", async () => {
    const { manager, root } = newManager();
    const { keys, calls } = countingKeys();
    const hub = central(keys, manager);
    for (let i = 0; i < FOLDERS; i++) {
      const cwd = join(root, `folder-${i}`);
      mkdirSync(cwd);
      await manager.create({ cwd, prompt: "hi" });
      hub.external.apply("SessionStart", { session_id: `x${i}`, cwd: join(root, `ext-${i}`) });
    }
    const endpoints = new LocalEndpoints({
      manager,
      external: hub.external,
      nameOf: () => null,
      projectKey: (cwd) => keys.known(cwd),
      cardOf: () => null,
      sendToLaunch: () => false,
    });
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
      central: hub,
      // Only the directory is read here; the real service lists the same endpoints.
      messaging: { messages: { directory: () => endpoints.list() } as unknown as Messaging },
      warmProjectKey: (cwd) => keys.resolve(cwd),
    });
    cleanups.push(() => server.stop());
    const client = await app(server.url);
    const data = await client.data<{ sessions: unknown[] }>("messages.directory", {});
    expect(data?.sessions.length).toBe(FOLDERS * 2);
    // The external sessions' keys were looked up, off the loop, when their hook events arrived.
    expect(calls.async).toBe(FOLDERS * 2);
  });
});

describe("history-perf: a list waits for the keys of its cold folders", () => {
  test("session.list answers its first request with the repository key of a cold folder", async () => {
    const { manager, root } = newManager();
    const cwd = join(root, "clone");
    mkdirSync(cwd);
    await manager.create({ cwd, prompt: "hi" });
    const keys = clonedKeys();
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
      central: central(keys, manager),
      warmProjectKey: (dir) => keys.resolve(dir),
    });
    cleanups.push(() => server.stop());
    const client = await app(server.url);
    const data = await client.data<{ sessions: Array<{ projectKey?: string }> }>(
      "session.list",
      {},
    );
    expect(data?.sessions.map((s) => s.projectKey)).toEqual(["github.com/acme/repo"]);
  });

  test("history.list answers its first request with the repository key of a cold folder", async () => {
    const root = projectsRoot();
    writeTranscript(root, "-clone", "s-clone", [
      userLine({ uuid: "u1", text: "hi", cwd: "/work/clone", ts: "2026-09-01T10:00:10.000Z" }),
    ]);
    const index = new HistoryIndexer({ db: new EventStore(":memory:").db, roots: [root] });
    cleanups.push(() => index.stop());
    await index.scan();
    const keys = clonedKeys();
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
      warmProjectKey: (dir) => keys.resolve(dir),
    });
    cleanups.push(() => server.stop());
    const client = await app(server.url);
    const page = await client.data<{ sessions: Array<{ projectKey?: string }> }>(
      "history.list",
      {},
    );
    expect(page?.sessions.map((s) => s.projectKey)).toEqual(["github.com/acme/repo"]);
  });
});
