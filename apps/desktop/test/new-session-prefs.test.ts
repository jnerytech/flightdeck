import { describe, expect, test } from "bun:test";
import { NEW_SESSION_PREFS_KEY, NewSessionPrefs } from "../src/lib/new-session-prefs.ts";

/** A storage that keeps what it is given. */
function storage(initial?: string) {
  const kept = new Map<string, string>(
    initial === undefined ? [] : [[NEW_SESSION_PREFS_KEY, initial]],
  );
  return {
    kept,
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  };
}

// Issue #1135: the New session form starts from the last mode, model and folder.
describe("new-session-prefs: the form starts from what the last session used", () => {
  test("nothing is remembered at first: the default mode, no model, no folder", () => {
    const prefs = new NewSessionPrefs(storage());
    expect(prefs.value).toEqual({ mode: "default", model: "", folders: {} });
    expect(prefs.folderOf("h1")).toBeUndefined();
  });

  test("a started session is remembered, and read back by the next window", () => {
    const store = storage();
    new NewSessionPrefs(store).remember("h1", {
      root: "/work",
      sub: "api",
      mode: "acceptEdits",
      model: "opus",
    });
    const next = new NewSessionPrefs(store);
    expect(next.value.mode).toBe("acceptEdits");
    expect(next.value.model).toBe("opus");
    expect(next.folderOf("h1")).toEqual({ root: "/work", sub: "api" });
  });

  test("each host keeps its own folder; the mode and model are shared", () => {
    const prefs = new NewSessionPrefs(storage());
    prefs.remember("h1", { root: "/a", sub: "", mode: "plan", model: "" });
    prefs.remember("h2", { root: "/b", sub: "x", mode: "auto", model: "haiku" });
    expect(prefs.folderOf("h1")).toEqual({ root: "/a", sub: "" });
    expect(prefs.folderOf("h2")).toEqual({ root: "/b", sub: "x" });
    expect(prefs.value.mode).toBe("auto");
    expect(prefs.value.model).toBe("haiku");
  });

  test("bypass is never remembered: the mode stays what it was", () => {
    const store = storage();
    const prefs = new NewSessionPrefs(store);
    prefs.remember("h1", { root: "/a", sub: "", mode: "plan", model: "" });
    prefs.remember("h1", { root: "/a", sub: "", mode: "bypassPermissions", model: "sonnet" });
    expect(prefs.value.mode).toBe("plan");
    expect(prefs.value.model).toBe("sonnet");
    expect(store.kept.get(NEW_SESSION_PREFS_KEY)).not.toContain("bypass");
    expect(new NewSessionPrefs(store).value.mode).toBe("plan");
  });

  test("a model the form does not offer is not kept, read or written", () => {
    const tampered = new NewSessionPrefs(storage('{"mode":"plan","model":"--dangerous"}'));
    expect(tampered.value.model).toBe("");
    const prefs = new NewSessionPrefs(storage());
    prefs.remember("h1", { root: "/a", sub: "", mode: "plan", model: "sonnet" });
    prefs.remember("h1", { root: "/a", sub: "", mode: "plan", model: "gpt-x" });
    expect(prefs.value.model).toBe("sonnet");
  });

  test("anything unreadable kept there starts from nothing", () => {
    for (const bad of [
      "{nope",
      "null",
      "[]",
      '{"mode":"bypassPermissions","model":3,"folders":7}',
      '{"mode":"nonsense"}',
    ]) {
      const prefs = new NewSessionPrefs(storage(bad));
      expect(prefs.value).toEqual({ mode: "default", model: "", folders: {} });
    }
  });

  test("a folder entry that is not a root and a subfolder is dropped, the good ones stay", () => {
    const prefs = new NewSessionPrefs(
      storage(
        JSON.stringify({ folders: { h1: { root: "/a", sub: "b" }, h2: { root: 3 }, h3: "x" } }),
      ),
    );
    expect(prefs.folderOf("h1")).toEqual({ root: "/a", sub: "b" });
    expect(prefs.folderOf("h2")).toBeUndefined();
    expect(prefs.folderOf("h3")).toBeUndefined();
  });

  test("a storage that throws leaves the form working and remembers nothing", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {},
    };
    const prefs = new NewSessionPrefs(broken);
    expect(prefs.value).toEqual({ mode: "default", model: "", folders: {} });
    expect(() =>
      prefs.remember("h1", { root: "/a", sub: "", mode: "plan", model: "" }),
    ).not.toThrow();
  });
});
