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
/** The oldest request the palette offers to answer, as the store hands it (issue #187). */
const OLDEST = { text: "alfa · Alpha: Bash: npm test", opens: false, key: "h1/r1" };
const sections = (s: AppState, query = "", recents?: string[], waiting = false) =>
  paletteSections(s, query, {
    costs: true,
    t: en,
    ...(waiting ? { oldest: OLDEST } : {}),
    ...(recents ? { recents } : {}),
  });
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

  // Issue #187: the commands name the request they answer, so nothing is approved unseen.
  test("approve and deny the oldest request show only while one waits, name it, with A and N", () => {
    const approve = `Approve the oldest request: ${OLDEST.text}`;
    const deny = `Deny the oldest request: ${OLDEST.text}`;
    expect(item(state(), approve)).toBeUndefined();
    expect(item(state(), deny)).toBeUndefined();
    expect(item(state(), approve, true)).toMatchObject({
      // The command carries the request it names (#245, L4).
      target: { kind: "decide-oldest", decision: "approve", key: "h1/r1" },
      shortcut: "A",
    });
    expect(item(state(), deny, true)).toMatchObject({
      target: { kind: "decide-oldest", decision: "deny", key: "h1/r1" },
      shortcut: "N",
    });
  });

  test("an oldest item that must be seen (a gate, a vault request, a high-risk one) offers only Open", () => {
    const gate = {
      text: "alfa · Ship: Workflow step “plan” waits for your approval",
      opens: true,
      key: "h1/gate:run1/plan/1",
    };
    const labels = paletteSections(state(), "", { costs: true, t: en, oldest: gate })
      .flatMap((section) => section.items)
      .map((i) => i.label);
    expect(labels).toContain(`Open the oldest request: ${gate.text}`);
    expect(
      labels.some((l) => l.startsWith("Approve the oldest") || l.startsWith("Deny the oldest")),
    ).toBe(false);
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
