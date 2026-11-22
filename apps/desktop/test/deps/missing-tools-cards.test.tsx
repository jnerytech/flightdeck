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

const missing = (id: string): DepResult =>
  ({ id, group: "required", state: "missing", breaks: [], fix: [] }) as unknown as DepResult;
const host = (id: string, name: string) => ({ id, name, status: "online" }) as never;

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  } as never;
}

/** The cards on one host, mounted again with other tools by `show`. */
function setup(lang: "en" | "pt-BR", tools: string[]) {
  const storage = memory();
  const setupSettings = new SetupSettings(storage);
  const store = { setup: setupSettings, openLink: () => {} } as never;
  const hosts = [host("h1", "alfa")];
  const ui = (ids: string[]) => (
    <TContext.Provider value={translator(lang)}>
      <MissingToolsCards
        store={store}
        hosts={hosts}
        deps={{ h1: { items: ids.map(missing) } } as never}
      />
    </TContext.Provider>
  );
  const view = render(ui(tools));
  return { storage, show: (ids: string[]) => view.rerender(ui(ids)) };
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
      screen.queryByRole("button", { name: "Dismiss the note about git on alfa" }) !== null,
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Dismiss the note about claude on alfa" }) !== null,
    ).toBe(true);
    cleanup();
    setup("pt-BR", ["git", "claude"]);
    expect(
      screen.queryByRole("button", { name: "Dispensar o aviso sobre git em alfa" }) !== null,
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Dispensar o aviso sobre claude em alfa" }) !== null,
    ).toBe(true);
  });

  test("a dismissed card leaves an Undo in its place and the focus moves to it", () => {
    setup("en", ["git", "claude", "node"]);
    press(/Dismiss the note about claude/);
    expect(dismissButtons(/Dismiss the note about claude/).length).toBe(0);
    expect(dismissButtons(/Dismiss the note about git/).length).toBe(1);
    expect(dismissButtons(/Dismiss the note about node/).length).toBe(1);
    const undo = screen.queryByRole("button", { name: /Undo.*claude on alfa/ });
    expect(undo !== null).toBe(true);
    expect(document.activeElement === undo).toBe(true);
  });

  test("Undo shows the card again, takes it out of the stored list and gives the focus back", () => {
    const { storage } = setup("en", ["git", "claude"]);
    press(/Dismiss the note about claude/);
    press(/Undo.*claude on alfa/);
    expect(dismissButtons(/Dismiss the note about claude/).length).toBe(1);
    expect(screen.queryByRole("button", { name: /Undo/ }) === null).toBe(true);
    expect(focused()).toBe("Dismiss");
    expect(new SetupSettings(storage).dismissedTools()).toEqual([]);
  });

  test("a card that arrives later is announced; the cards of the first render are not", () => {
    const { show } = setup("en", ["git"]);
    expect(statusText()).toBe("");
    act(() => show(["git", "claude"]));
    expect(statusText()).toContain("claude is missing on alfa");
    expect(statusText()?.includes("git is missing")).toBe(false);
  });

  test("dismissing is announced too, in Portuguese as well", () => {
    setup("pt-BR", ["git"]);
    press(/Dispensar o aviso sobre git/);
    expect(statusText()).toContain("Aviso sobre git em alfa dispensado");
  });
});
