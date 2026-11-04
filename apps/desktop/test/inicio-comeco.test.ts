import { describe, expect, test } from "bun:test";
import { WORKSPACE_KEY, Workspace } from "../src/lib/workspace.ts";
import { memoryPlatform } from "./fixtures.ts";

const { AppStore } = await import("../src/lib/app-store.ts");

const overview = { name: "overview" } as const;
const shape = (ws: Workspace) => ws.areas.map((a) => a.tabs.map((t) => t.router.current.name));

describe("inicio-comeco: Home is where a fresh window starts", () => {
  test("a window with nothing saved opens on the screen it is given, and on Sessions when none", () => {
    expect(Workspace.restore(null, undefined, overview).router.current.name).toBe("overview");
    expect(Workspace.restore(null).router.current.name).toBe("home");
    // Anything unusable is a fresh window too.
    expect(Workspace.restore({ v: 9, areas: "no" }, undefined, overview).router.current.name).toBe(
      "overview",
    );
    expect(Workspace.restore({ v: 1, areas: [] }, undefined, overview).router.current.name).toBe(
      "overview",
    );
  });

  test("a saved window keeps its tabs, whatever the start screen is", () => {
    const saved = new Workspace();
    saved.router.push({ name: "costs" });
    saved.tabs.open({ name: "settings" });
    const back = Workspace.restore(
      JSON.parse(JSON.stringify(saved.snapshot())),
      undefined,
      overview,
    );
    expect(shape(back)).toEqual([["costs", "settings"]]);
  });

  test("the store starts on its startRoute when fresh, and keeps the saved tabs after that", () => {
    const platform = memoryPlatform(false, "en").platform;
    const first = new AppStore(platform, { startRoute: overview });
    expect(first.router.current.name).toBe("overview");
    first.tabs.open({ name: "costs" });
    expect(platform.storage.getItem(WORKSPACE_KEY)).not.toBeNull();
    first.dispose();
    const second = new AppStore(platform, { startRoute: overview });
    expect(second.tabs.tabs.map((t) => t.router.current.name)).toEqual(["overview", "costs"]);
    second.dispose();
  });

  test("without a startRoute a fresh store is on Sessions, as before", () => {
    const store = new AppStore(memoryPlatform(false, "en").platform);
    expect(store.router.current.name).toBe("home");
    store.dispose();
  });
});
