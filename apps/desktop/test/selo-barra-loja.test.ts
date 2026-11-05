import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AppStore } from "../src/lib/app-store.ts";
import { tauriPlatform } from "../src/platform/tauri/index.ts";
import { memoryPlatform } from "./fixtures.ts";

const stores: Array<{ dispose(): void }> = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
});

function world(stored: unknown[] = []) {
  const mem = memoryPlatform(false, "en");
  if (stored.length > 0) mem.items.set("flightdeck.inbox", JSON.stringify(stored));
  const badges: number[] = [];
  mem.platform.setBadge = async (count: number) => void badges.push(count);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  stores.push(store);
  const notify = (n: object) => (store as unknown as { notifyUser(n: object): void }).notifyUser(n);
  return { store, mem, badges, notify };
}

const entry = (id: string, read: boolean, group?: string) => ({
  id,
  at: new Date().toISOString(),
  title: id,
  body: "",
  read,
  ...(group ? { group } : {}),
});

describe("selo-barra-loja: the badge follows the bell (issue #233)", () => {
  test("a new notification raises the count, and each row counts once", () => {
    const w = world();
    w.notify({ title: "a", body: "", about: { subject: "A", host: "h", group: "g1" } });
    w.notify({ title: "b", body: "", about: { subject: "B", host: "h", group: "g2" } });
    // The same session asking again is the same row of the panel.
    w.notify({ title: "c", body: "", about: { subject: "A", host: "h", group: "g1" } });
    expect(w.badges).toEqual([1, 2]);
  });

  test("marking everything read clears it; clearing the list keeps it clear", () => {
    const w = world();
    w.notify({ title: "a", body: "" });
    w.store.inboxMarkAllRead();
    expect(w.badges).toEqual([1, 0]);
    w.store.inboxClear();
    expect(w.badges).toEqual([1, 0]);
  });

  test("reading one entry lowers it", () => {
    const w = world();
    w.notify({ title: "a", body: "", about: { subject: "A", host: "h", group: "g1" } });
    w.notify({ title: "b", body: "", about: { subject: "B", host: "h", group: "g2" } });
    const first = w.store.getState().inbox[0]?.id as string;
    w.store.inboxMarkRead(first);
    expect(w.badges).toEqual([1, 2, 1]);
  });

  test("when the app starts, the unread from last time show at once", async () => {
    const w = world([entry("e1", false, "g1"), entry("e2", false, "g2"), entry("e3", true)]);
    await w.store.init();
    expect(w.badges).toEqual([2]);
  });

  test("a start with nothing unread tells nothing", async () => {
    const w = world([entry("e1", true)]);
    await w.store.init();
    expect(w.badges).toEqual([]);
  });

  test("a platform with no badge (a browser) is left alone", () => {
    const mem = memoryPlatform(false, "en");
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    stores.push(store);
    expect(() =>
      (store as unknown as { notifyUser(n: object): void }).notifyUser({ title: "a", body: "" }),
    ).not.toThrow();
  });

  test("a platform that fails to set it does not break the notification", async () => {
    const w = world();
    w.mem.platform.setBadge = async () => {
      throw new Error("no taskbar");
    };
    w.notify({ title: "a", body: "" });
    await Bun.sleep(1);
    expect(w.store.getState().inbox).toHaveLength(1);
  });
});

describe("selo-barra-loja: the desktop shell (issue #233)", () => {
  test("the badge goes to the shell as pixels, and zero as an empty picture", async () => {
    const invokes: Array<[string, { rgba: number[] }]> = [];
    const call = (async (cmd: string, args?: unknown) => {
      invokes.push([cmd, args as { rgba: number[] }]);
    }) as never;
    const platform = tauriPlatform({} as never, call);
    await platform.setBadge?.(3);
    await platform.setBadge?.(0);
    expect(invokes.map(([cmd]) => cmd)).toEqual(["set_unread_badge", "set_unread_badge"]);
    expect(invokes[0]?.[1].rgba).toHaveLength(32 * 32 * 4);
    expect(invokes[1]?.[1].rgba).toEqual([]);
  });

  const root = join(import.meta.dir, "../src-tauri");
  const rust = readFileSync(join(root, "src/lib.rs"), "utf8");
  const capability = JSON.parse(readFileSync(join(root, "capabilities/default.json"), "utf8")) as {
    permissions: Array<string | { identifier: string }>;
  };
  const identifiers = capability.permissions.map((p) => (typeof p === "string" ? p : p.identifier));

  test("the shell has a command for it, registered, that checks the size before it sets anything", () => {
    expect(rust).toContain("fn set_unread_badge(");
    expect(rust).toMatch(/generate_handler!\[[^\]]*set_unread_badge/s);
    expect(rust).toContain("fn badge_image_ok(");
    expect(rust).toContain("set_overlay_icon");
    // Only the main window, only on Windows, and an empty picture clears it.
    expect(rust).toMatch(/cfg\(windows\)[\s\S]{0,400}set_overlay_icon/);
    expect(rust).toContain('get_webview_window("main")');
  });

  test("the webview is not given the window's overlay permission: it can only ask this command", () => {
    for (const refused of [
      "core:window:allow-set-overlay-icon",
      "core:window:default",
      "core:window:allow-set-badge-count",
    ]) {
      expect(identifiers).not.toContain(refused);
    }
  });
});
