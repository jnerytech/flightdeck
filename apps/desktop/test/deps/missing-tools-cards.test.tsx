import { afterEach, describe, expect, test } from "bun:test";
import type { DepResult } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");
const { MissingToolsCards } = await import("../../src/features/deps/missing-tools-cards.tsx");
const { SetupSettings } = await import("../../src/features/setup/index.ts");

afterEach(cleanup);

const missing = (id: string, over: object = {}): DepResult =>
  ({
    id,
    group: "required",
    state: "missing",
    breaks: [],
    fix: [],
    ...over,
  }) as unknown as DepResult;
const host = (id: string, name: string) => ({ id, name, status: "online" }) as never;

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  } as never;
}

/** The cards on one host, mounted again with other tools by `show`. */
function setup(lang: "en" | "pt-BR", tools: Array<string | DepResult>, kept = memory()) {
  const storage = kept;
  const setupSettings = new SetupSettings(storage);
  const store = { setup: setupSettings, openLink: () => {} } as never;
  const hosts = [host("h1", "alfa")];
  const ui = (ids: Array<string | DepResult>) => (
    <TContext.Provider value={translator(lang)}>
      <MissingToolsCards
        store={store}
        hosts={hosts}
        deps={
          { h1: { items: ids.map((id) => (typeof id === "string" ? missing(id) : id)) } } as never
        }
      />
    </TContext.Provider>
  );
  const view = render(ui(tools));
  return { storage, show: (ids: Array<string | DepResult>) => view.rerender(ui(ids)) };
}

const focused = () => document.activeElement?.textContent ?? "";
const statusText = () => screen.queryByRole("status")?.textContent ?? null;
function press(name: RegExp) {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  if (button) fireEvent.click(button);
}
const dismissButtons = (name: RegExp) => screen.queryAllByRole("button", { name });

describe("missing-tool cards: a person who cannot see the screen can use them (issue #4069)", () => {
  test("each dismiss button names its tool and its host, in both languages", () => {
    setup("en", ["git", "claude"]);
    expect(
      screen.queryByRole("button", { name: "Dismiss the note about Git on alfa" }) !== null,
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Dismiss the note about Claude Code on alfa" }) !== null,
    ).toBe(true);
    cleanup();
    setup("pt-BR", ["git", "claude"]);
    expect(
      screen.queryByRole("button", { name: "Dispensar o aviso sobre Git em alfa" }) !== null,
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Dispensar o aviso sobre Claude Code em alfa" }) !==
        null,
    ).toBe(true);
  });

  test("a dismissed card leaves an Undo in its place and the focus moves to it", () => {
    setup("en", ["git", "claude", "gh"]);
    press(/Dismiss the note about Claude Code/);
    expect(dismissButtons(/Dismiss the note about Claude Code/).length).toBe(0);
    expect(dismissButtons(/Dismiss the note about Git on/).length).toBe(1);
    expect(dismissButtons(/Dismiss the note about GitHub CLI/).length).toBe(1);
    const undo = screen.queryByRole("button", { name: /Undo.*Claude Code on alfa/ });
    expect(undo !== null).toBe(true);
    expect(document.activeElement === undo).toBe(true);
  });

  test("Undo shows the card again, takes it out of the stored list and gives the focus back", () => {
    const { storage } = setup("en", ["git", "claude"]);
    press(/Dismiss the note about Claude Code/);
    press(/Undo.*Claude Code on alfa/);
    expect(dismissButtons(/Dismiss the note about Claude Code/).length).toBe(1);
    expect(screen.queryByRole("button", { name: /Undo/ }) === null).toBe(true);
    expect(focused()).toBe("Dismiss");
    expect(new SetupSettings(storage).dismissedTools()).toEqual([]);
  });

  test("a card that comes back later does not pull the focus away from where the person is", () => {
    const { show } = setup("en", ["git", "claude"]);
    press(/Dismiss the note about Claude Code/);
    press(/Undo.*Claude Code on alfa/);
    const git = screen.queryByRole("button", { name: /Dismiss the note about Git on/ });
    expect(git).not.toBeNull();
    act(() => git?.focus());
    act(() => show(["git"]));
    act(() => show(["git", "claude"]));
    expect(document.activeElement === git).toBe(true);
  });

  test("a card that arrives later is announced; the cards of the first render are not", () => {
    const { show } = setup("en", ["git"]);
    expect(statusText()).toBe("");
    act(() => show(["git", "claude"]));
    expect(statusText()).toContain("Claude Code is missing on alfa");
    expect(statusText()?.includes("Git is missing")).toBe(false);
  });

  test("dismissing is announced too, in Portuguese as well", () => {
    setup("pt-BR", ["git"]);
    press(/Dispensar o aviso sobre Git/);
    expect(statusText()).toContain("Aviso sobre Git em alfa dispensado");
  });
});

const FIX = [{ os: "linux", url: "https://example.com/install" }];
const note = (name: string) => screen.queryByRole("note", { name });

describe("missing-tool cards: they say which tool and what it limits (issue #4097)", () => {
  test("the title names the tool as the host health screen does, and the text lists what it limits", () => {
    setup("en", [
      missing("gh", { group: "optional", breaks: ["pullRequests", "boardSync"] }),
      missing("git"),
    ]);
    const card = note("GitHub CLI (gh) is missing on alfa");
    expect(card?.textContent ?? "").toContain(
      "Without it: pull requests from a card, board sync with GitHub Projects",
    );
    expect(note("Git is missing on alfa")?.textContent ?? "").toContain("Some features need it.");
  });

  test("the same in Portuguese", () => {
    setup("pt-BR", [missing("gh", { group: "optional", breaks: ["pullRequests"] })]);
    const card = note("GitHub CLI (gh) não está em alfa");
    expect(card?.textContent ?? "").toContain("Sem isso:");
  });

  test("two cards give their install links different names, with the tool and the host", () => {
    setup("en", [missing("gh", { fix: FIX }), missing("claude", { fix: FIX })]);
    expect(
      screen.queryByRole("link", { name: "How to install GitHub CLI (gh) on alfa" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("link", { name: "How to install Claude Code on alfa" }),
    ).not.toBeNull();
    cleanup();
    setup("pt-BR", [missing("claude", { fix: FIX })]);
    expect(
      screen.queryByRole("link", { name: "Como instalar Claude Code em alfa" }),
    ).not.toBeNull();
  });
});

describe("missing-tool cards: a dismissed note has a way back, and a tool out of date a card (issue #4098)", () => {
  test("a note dismissed before the screen was shown is counted, and one press shows them all again", () => {
    const kept = memory();
    setup("en", ["git", "claude"], kept);
    press(/Dismiss the note about Git on/);
    press(/Dismiss the note about Claude Code/);
    cleanup();
    setup("en", ["git", "claude"], kept);
    expect(screen.queryAllByRole("note").length).toBe(0);
    expect(screen.queryByText("Dismissed notes: 2")).not.toBeNull();
    press(/Show them again/);
    expect(screen.queryAllByRole("note").length).toBe(2);
    expect(screen.queryByText(/Dismissed notes/)).toBeNull();
    expect(new SetupSettings(kept).dismissedTools()).toEqual([]);
    expect(focused()).toBe("Dismiss");
  });

  test("a note whose Undo is on screen is not counted, and the line speaks Portuguese too", () => {
    const kept = memory();
    setup("pt-BR", ["git", "claude"], kept);
    press(/Dispensar o aviso sobre Git/);
    expect(screen.queryByText(/Avisos dispensados/)).toBeNull();
    cleanup();
    setup("pt-BR", ["git", "claude"], kept);
    expect(screen.queryByText("Avisos dispensados: 1")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Mostrar de novo/ })).not.toBeNull();
  });

  test("a dismissal for a tool that is not lacking is not counted", () => {
    const kept = memory();
    new SetupSettings(kept).dismissTool("gh@h1");
    setup("en", ["git"], kept);
    expect(screen.queryByText(/Dismissed notes/)).toBeNull();
  });

  test("a tool that is out of date gets its card: what version it needs, and how to update it", () => {
    setup("en", [
      missing("git", { state: "outdated", minVersion: "2.30", breaks: ["worktrees"], fix: FIX }),
    ]);
    const card = note("Git is out of date on alfa");
    expect(card?.textContent ?? "").toContain("Needs version 2.30 or newer.");
    expect(card?.textContent ?? "").toContain("Without it: card worktrees and branches");
    expect(screen.queryByRole("link", { name: "How to update Git on alfa" })).not.toBeNull();
  });
});
