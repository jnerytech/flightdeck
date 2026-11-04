import { afterEach, describe, expect, test } from "bun:test";
import { AppStore } from "../src/lib/app-store.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function setup(withPlatform: boolean, url?: (real: string) => string) {
  const mem = memoryPlatform();
  const calls: string[] = [];
  if (withPlatform) {
    mem.platform.openPath = async (path) => void calls.push(`open:${path}`);
    mem.platform.revealPath = async (path) => void calls.push(`reveal:${path}`);
  }
  const d = makeDaemon(cleanups);
  const server = d.listen();
  const store = new AppStore(mem.platform, { baseDelayMs: 10 });
  cleanups.push(() => store.dispose());
  const hostId = await store.addHost({
    name: "pc",
    url: url ? url(server.url) : server.url,
    token: TOKEN,
  });
  await waitFor(() => store.getState().hosts.find((h) => h.id === hostId));
  return { store, hostId, calls, mem };
}

describe("abrir-resultado: opening what a task made, through the platform", () => {
  test("Given the desktop app and a host on this machine, When a file is opened or shown, Then the platform does it", async () => {
    const { store, hostId, calls } = await setup(true);
    expect(store.canOpenPaths(hostId)).toBe(true);
    expect(await store.openPath(hostId, "/work/Reports/a.docx")).toBe(true);
    expect(await store.revealPath(hostId, "/work/Reports/a.docx")).toBe(true);
    expect(calls).toEqual(["open:/work/Reports/a.docx", "reveal:/work/Reports/a.docx"]);
  });

  test("Given a browser, which has no way to open a file, Then it says it cannot and does nothing", async () => {
    const { store, hostId, calls } = await setup(false);
    expect(store.canOpenPaths(hostId)).toBe(false);
    expect(await store.openPath(hostId, "/work/a.docx")).toBe(false);
    expect(calls).toEqual([]);
  });

  test("Given a host on another machine, Then its paths are not opened here", async () => {
    const { store, hostId, calls } = await setup(true, (real) =>
      real.replace("127.0.0.1", "localhost.example.com"),
    );
    expect(store.canOpenPaths(hostId)).toBe(false);
    expect(await store.openPath(hostId, "/work/a.docx")).toBe(false);
    expect(calls).toEqual([]);
  });

  test("Given a platform that cannot open the file, Then it says so and nothing else happens", async () => {
    const { store, hostId, mem } = await setup(true);
    mem.platform.openPath = async () => {
      throw new Error("no program is set for this file");
    };
    expect(await store.openPath(hostId, "/work/Reports/a.docx")).toBe(false);
  });

  test("Given a path that is not absolute, Then it is refused", async () => {
    const { store, hostId, calls } = await setup(true);
    expect(await store.openPath(hostId, "../a.docx")).toBe(false);
    expect(await store.revealPath(hostId, "relative/a.docx")).toBe(false);
    expect(calls).toEqual([]);
  });

  test("Given a path with two leading separators, Then it is refused (on Windows both are UNC)", async () => {
    const { store, hostId, calls } = await setup(true);
    for (const path of ["/\\attacker\\share\\a.pdf", "\\\\.\\pipe\\x.pdf", "//server/a.pdf"]) {
      expect(await store.openPath(hostId, path)).toBe(false);
      expect(await store.revealPath(hostId, path)).toBe(false);
    }
    expect(calls).toEqual([]);
  });
});
