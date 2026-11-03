import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import type { AppState } from "../src/lib/app-store.ts";
import { paletteSections } from "../src/lib/palette.ts";

const state = () =>
  ({
    hosts: [
      {
        id: "h1",
        name: "alfa",
        status: "online",
        sessions: [{ id: "s1", name: "Alpha", cwd: "/p/alpha", status: "idle" }],
      },
    ],
    sessions: {},
    hub: {},
    externals: {},
    meta: {},
    cards: {},
    projects: {},
    ssh: {},
  }) as unknown as AppState;

const en = translator("en");
const sections = (s: AppState, query = "", recents?: string[], waiting = false) =>
  paletteSections(s, query, { costs: true, t: en, waiting, ...(recents ? { recents } : {}) });
const items = (s: AppState, query = "", waiting = false) =>
  sections(s, query, undefined, waiting).flatMap((section) => section.items);
const item = (s: AppState, label: string, waiting = false) =>
  items(s, "", waiting).find((i) => i.label === label);

describe("paleta-v2: commands with their shortcut", () => {
  test("the go-to commands name their screen and carry the keys of the registry", () => {
    const s = state();
    expect(item(s, "Go to Sessions")).toMatchObject({
      target: { kind: "go", to: "hub" },
      shortcut: "g s",
    });
    expect(item(s, "Go to Needs you")).toMatchObject({
      target: { kind: "go", to: "needs-you" },
      shortcut: "g n",
    });
    expect(item(s, "Go to Projects")).toMatchObject({
      target: { kind: "go", to: "all-projects" },
      shortcut: "g p",
    });
  });

  test("Costs and Settings, which were already there, now show their keys", () => {
    const s = state();
    expect(items(s).find((i) => i.target.kind === "costs")?.shortcut).toBe("g c");
    expect(items(s).find((i) => i.target.kind === "settings")?.shortcut).toBe("g ,");
  });

  test("the shortcuts sheet is a command, and a command with no shortcut has no hint", () => {
    const s = state();
    expect(item(s, "Show the keyboard shortcuts")).toMatchObject({
      target: { kind: "shortcuts" },
      shortcut: "?",
    });
    expect(item(s, "Toggle theme")?.shortcut).toBeUndefined();
  });

  test("approve and deny the oldest request show only while one waits, with A and N", () => {
    expect(item(state(), "Approve the oldest request")).toBeUndefined();
    expect(item(state(), "Deny the oldest request")).toBeUndefined();
    const waiting = state();
    expect(item(waiting, "Approve the oldest request", true)).toMatchObject({
      target: { kind: "decide-oldest", decision: "approve" },
      shortcut: "A",
    });
    expect(item(waiting, "Deny the oldest request", true)).toMatchObject({
      target: { kind: "decide-oldest", decision: "deny" },
      shortcut: "N",
    });
  });

  test("the commands match what is typed, and the same words in Portuguese", () => {
    expect(items(state(), "projects").map((i) => i.label)).toContain("Go to Projects");
    const pt = paletteSections(state(), "", { costs: true, t: translator("pt-BR") });
    expect(pt.flatMap((x) => x.items).map((i) => i.label)).toContain("Ir para Projetos");
  });
});

describe("paleta-v2: recents", () => {
  test("with nothing typed, the recent entries come first, in the order given", () => {
    const s = state();
    const out = sections(s, "", ["theme", "session:h1/s1"]);
    expect(out[0]?.title).toBe("Recent");
    expect(out[0]?.items.map((i) => i.id)).toEqual(["theme", "session:h1/s1"]);
    // They stay in their own sections too.
    expect(out.some((x) => x.title !== "Recent" && x.items.some((i) => i.id === "theme"))).toBe(
      true,
    );
  });

  test("an id that is gone is dropped, and at most five show", () => {
    const s = state();
    const all = items(s).map((i) => i.id);
    const out = sections(s, "", ["gone:1", ...all.slice(0, 8)]);
    expect(out[0]?.items).toHaveLength(5);
    expect(out[0]?.items.map((i) => i.id)).toEqual(all.slice(0, 5));
  });

  test("once something is typed, or with no recents, there is no Recent section", () => {
    const s = state();
    expect(sections(s, "theme", ["theme"]).some((x) => x.title === "Recent")).toBe(false);
    expect(sections(s, "", []).some((x) => x.title === "Recent")).toBe(false);
    expect(sections(s, "").some((x) => x.title === "Recent")).toBe(false);
  });
});
