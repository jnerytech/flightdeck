import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { AppStore } from "../src/lib/app-store.ts";
import { HostConnection } from "../src/lib/host-connection.ts";
import { projectTree } from "../src/lib/project-tree.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { settlePlain as settle, settleMaybe, stays } from "./wait.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function repo(root: string, name: string): Promise<string> {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  await Bun.spawn(["git", "init", "-q", path]).exited;
  return path;
}

async function setup() {
  const d = makeDaemon(cleanups);
  const shop = await d.board.addProject({ path: await repo(d.root, "shop") });
  const server = d.listen();
  const store = new AppStore(memoryPlatform(false, "en").platform, {
    baseDelayMs: 10,
    maxDelayMs: 20,
  });
  cleanups.push(() => store.dispose());
  // Every `project.list` that leaves the app, whoever asks (the screens' list or the setup probe).
  const asked: string[] = [];
  const real = HostConnection.prototype.request;
  HostConnection.prototype.request = function (this: HostConnection, type: string, ...rest) {
    if (type === "project.list") asked.push(type);
    return (real as (...args: unknown[]) => unknown).call(this, type, ...rest) as never;
  } as typeof real;
  cleanups.push(() => {
    HostConnection.prototype.request = real;
  });
  return { d, server, store, shop, asked };
}

const statusOf = (store: AppStore, hostId: string) =>
  store.getState().hosts.find((h) => h.id === hostId)?.status;
const names = (store: AppStore, hostId: string) =>
  (store.getState().projects[hostId] ?? []).map((p) => p.name);
const treeNames = (store: AppStore) =>
  projectTree(store.getState(), []).map((p) => `${p.hostId}:${p.name}`);

describe("tree-on-connect: the sidebar project tree fills when a host comes online", () => {
  test("a host that connects gets its projects into the state, once, with no page asking", async () => {
    const { server, store, asked } = await setup();
    const hostId = await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
    await settle(() => statusOf(store, hostId) === "online");
    expect(await settleMaybe(() => names(store, hostId).length > 0)).toBe(true);
    expect(names(store, hostId)).toEqual(["shop"]);
    expect(treeNames(store)).toEqual([`${hostId}:shop`]);
    await stays(() => asked.length === 1, 300, "one project.list for the connect");
  });

  test("a reconnect reloads the host's projects without duplicating them", async () => {
    const { d, server, store, asked } = await setup();
    const hostId = await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
    expect(await settleMaybe(() => names(store, hostId).length === 1)).toBe(true);
    const port = server.port;
    await server.stop();
    await settle(() => statusOf(store, hostId) !== "online");
    await d.board.addProject({ path: await repo(d.root, "docs") });
    d.listen(port);
    await settle(() => statusOf(store, hostId) === "online");
    expect(await settleMaybe(() => names(store, hostId).length === 2)).toBe(true);
    expect(names(store, hostId).sort()).toEqual(["docs", "shop"]);
    expect(treeNames(store).sort()).toEqual([`${hostId}:docs`, `${hostId}:shop`]);
    expect(asked).toEqual(["project.list", "project.list"]);
  });

  test("a host that goes offline keeps its projects in the state and leaves the tree", async () => {
    const { server, store } = await setup();
    const hostId = await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
    expect(await settleMaybe(() => names(store, hostId).length === 1)).toBe(true);
    await server.stop();
    await settle(() => statusOf(store, hostId) !== "online");
    expect(names(store, hostId)).toEqual(["shop"]);
    expect(treeNames(store)).toEqual([]);
  });
});
