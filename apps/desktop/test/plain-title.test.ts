import { afterEach, describe, expect, test } from "bun:test";
import { type PendingPermission, plainInfo } from "@flightdeck/protocol";
import { translator } from "../src/i18n/index.ts";
import { AppStore } from "../src/lib/app-store.ts";
import { trayStatus } from "../src/lib/tray.ts";
import { memoryPlatform } from "./fixtures.ts";

/**
 * Issue #88: the window title and the tray tooltip follow the mode of the host that raised the
 * request: in simple mode they say how many tasks wait for an answer, in plain words.
 */
const en = translator("en");
const plain = plainInfo({
  toolName: "Write",
  input: { file_path: "/w/Reports/a.md" },
  fileExists: false,
  risk: "low",
});
const request = (n: number): PendingPermission => ({
  requestId: `r${n}`,
  toolName: "Write",
  createdAt: "2026-11-06T10:00:00.000Z",
  plain,
});

const stores: AppStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
});

/** A store whose platform records the titles it is told, with one host in `mode`. */
function setup(mode: "simple" | "full", waiting: number) {
  const titles: string[] = [];
  const mem = memoryPlatform(false, "en");
  mem.platform.setTitle = async (title) => void titles.push(title);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  stores.push(store);
  store.i18n.start();
  const host = (count: number) => ({
    id: "h1",
    name: "alfa",
    status: "online" as const,
    hostInfo: { daemonVersion: "x", features: [], ui: { mode, locked: false } },
    sessions: [
      {
        id: "s1",
        name: "Reports",
        cwd: "/w",
        status: "awaiting_permission" as const,
        updatedAt: "t",
        pendingPermissions: Array.from({ length: count }, (_, i) => request(i + 1)),
      },
    ],
  });
  const set = (count: number) =>
    (store as unknown as { update(patch: object): void }).update({ hosts: [host(count)] });
  set(waiting);
  return { titles, set, store };
}

describe("plain-title: the window title", () => {
  test("Given a host in simple mode, Then the title says how many tasks wait, and goes back when none does", () => {
    const { titles, set } = setup("simple", 1);
    expect(titles.at(-1)).toBe("Flightdeck: 1 task waiting for your answer");
    set(2);
    expect(titles.at(-1)).toBe("Flightdeck: 2 tasks waiting for your answer");
    set(0);
    expect(titles.at(-1)).toBe("Flightdeck");
  });

  test("Given a host in full mode, Then the title is never changed", () => {
    const { titles, set } = setup("full", 2);
    set(3);
    expect(titles).toEqual([]);
  });

  test("Given the same count again, Then the platform is not told twice", () => {
    const { titles, set } = setup("simple", 1);
    set(1);
    set(1);
    expect(titles).toEqual(["Flightdeck: 1 task waiting for your answer"]);
  });

  test("Given a platform that cannot set the title, Then the app goes on and the next change is still tried", async () => {
    const mem = memoryPlatform(false, "en");
    let tried = 0;
    mem.platform.setTitle = async () => {
      tried++;
      throw new Error("no window");
    };
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    stores.push(store);
    store.i18n.start();
    const host = (count: number) => ({
      id: "h1",
      name: "alfa",
      status: "online" as const,
      hostInfo: { daemonVersion: "x", features: [], ui: { mode: "simple", locked: false } },
      sessions: [
        {
          id: "s1",
          name: "Reports",
          cwd: "/w",
          status: "awaiting_permission" as const,
          updatedAt: "t",
          pendingPermissions: Array.from({ length: count }, (_, i) => request(i + 1)),
        },
      ],
    });
    const update = (store as unknown as { update(patch: object): void }).update.bind(store);
    update({ hosts: [host(1)] });
    update({ hosts: [host(2)] });
    await Promise.resolve();
    expect(tried).toBe(2);
  });

  test("Given the person switches the host to full mode, Then the title goes back to the plain name", () => {
    const { titles, store } = setup("simple", 2);
    store.setUiChoice("h1", "full");
    expect(titles.at(-1)).toBe("Flightdeck");
  });
});

describe("plain-title: the tray tooltip", () => {
  const host = (simple: boolean, name = "alfa") => ({
    name,
    simple,
    sessions: [{ pendingPermissions: [request(1), request(2)] }],
  });

  test("Given every host with a waiting request in simple mode, Then the tooltip is in plain words", () => {
    expect(trayStatus([host(true)], en).tooltip).toBe(
      "Flightdeck: 2 tasks waiting for your answer (alfa: 2)",
    );
  });

  test("Given a host in full mode among them, Then the tooltip is the usual one", () => {
    expect(trayStatus([host(true), host(false, "beta")], en).tooltip).toBe(
      "Flightdeck: 4 requests waiting for you (alfa: 2, beta: 2)",
    );
  });
});
