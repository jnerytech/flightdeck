import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "../dom.ts";
import { uiIdle } from "../wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");
const { RulesSection } = await import("../../src/features/permissions/project-rules.tsx");

import type { AppStore } from "../../src/lib/app-store.ts";

afterEach(cleanup);

type Answer =
  | { ok: true; data: { rules: string[] } }
  | { ok: false; code: string; message: string };

/** A promise the test settles by hand, so a wait on the host can be looked at. */
function pending() {
  let settle: (answer: Answer) => void = () => {};
  const promise = new Promise<Answer>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** A store whose `rules.list` and `rules.remove` answers come from `script`, in order, per command. */
function fakeStore(script: Record<"rules.list" | "rules.remove", Array<Promise<Answer> | Answer>>) {
  const calls: string[] = [];
  return {
    calls,
    store: {
      hostRequest: async (_host: string, command: "rules.list" | "rules.remove") => {
        calls.push(command);
        const next = script[command].shift();
        if (!next) throw new Error(`no answer scripted for ${command}`);
        return next;
      },
      // What the section used before it read the refusal: the data, or null.
      hostCommand: async (_host: string, command: "rules.list" | "rules.remove") => {
        const next = await script[command].shift();
        return next?.ok ? next.data : null;
      },
      subscribe: () => () => {},
      getState: () => ({ loopAlerts: [] }),
      i18n: { t: translator("en") },
    } as unknown as AppStore,
  };
}

const view = (store: AppStore, language: "en" | "pt-BR" = "en") =>
  render(
    <TContext.Provider value={translator(language)}>
      <RulesSection store={store} hostId="h" projectId="p" />
    </TContext.Provider>,
  );

const ok = (...rules: string[]): Answer => ({ ok: true, data: { rules } });
const refused = (message: string): Answer => ({ ok: false, code: "host_refused", message });
const text = (container: HTMLElement) => container.textContent ?? "";
const press = async (container: HTMLElement, name: string | RegExp) => {
  const button = within(container).queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const confirmRemoval = async () => {
  const dialog = within(document.body).queryByRole("alertdialog");
  expect(dialog).not.toBeNull();
  await press(dialog as HTMLElement, "Remove rule");
};

describe("project rules section: what it says while it waits and when the host refuses (#4159)", () => {
  test("while the list is read, a loading line shows and 'No rules yet' does not", async () => {
    const list = pending();
    const { store } = fakeStore({ "rules.list": [list.promise], "rules.remove": [] });
    const { container } = view(store);
    await uiIdle();
    expect({
      loading: within(container).queryByRole("status", { name: "Loading the rules" }) !== null,
      empty: text(container).includes("No rules yet"),
    }).toEqual({ loading: true, empty: false });
  });

  test("a refused list shows its message and Try again; pressing it shows the rules", async () => {
    const { store } = fakeStore({
      "rules.list": [refused("the host cannot read the project"), ok("Bash(git status:*)")],
      "rules.remove": [],
    });
    const { container } = view(store);
    await uiIdle();
    expect({
      alert: within(container).queryByRole("alert")?.textContent?.includes("cannot read") ?? false,
      empty: text(container).includes("No rules yet"),
    }).toEqual({ alert: true, empty: false });
    await press(container, "Try again");
    await uiIdle();
    expect(text(container)).toContain("Bash(git status:*)");
  });

  test("a remove not answered yet says the row is being removed and turns its button off", async () => {
    const removal = pending();
    const { store } = fakeStore({
      "rules.list": [ok("Bash(git status:*)")],
      "rules.remove": [removal.promise],
    });
    const { container } = view(store);
    await uiIdle();
    await press(container, "Remove Bash(git status:*)");
    await confirmRemoval();
    await uiIdle();
    const button = within(container).queryByRole("button", { name: /Remove Bash/ });
    expect({
      said: text(container).includes("Removing…"),
      off: (button as HTMLButtonElement | null)?.disabled,
    }).toEqual({ said: true, off: true });
  });

  test("a refused remove says so in the section and the row's button works again", async () => {
    const { store } = fakeStore({
      "rules.list": [ok("Bash(git status:*)")],
      "rules.remove": [refused("settings.local.json is read-only")],
    });
    const { container } = view(store);
    await uiIdle();
    await press(container, "Remove Bash(git status:*)");
    await confirmRemoval();
    await uiIdle();
    const button = within(container).queryByRole("button", { name: /Remove Bash/ });
    expect({
      said: within(container).queryByRole("alert")?.textContent?.includes("read-only") ?? false,
      kept: text(container).includes("Bash(git status:*)"),
      usable: (button as HTMLButtonElement | null)?.disabled === false,
    }).toEqual({ said: true, kept: true, usable: true });
  });

  test("after a remove that worked the focus is inside the section, not on the page", async () => {
    const { store } = fakeStore({
      "rules.list": [ok("Bash(git status:*)")],
      "rules.remove": [ok()],
    });
    const { container } = view(store);
    await uiIdle();
    await press(container, "Remove Bash(git status:*)");
    await confirmRemoval();
    await uiIdle();
    const section = within(container).queryByRole("region", { name: "Rules" });
    expect({
      removed: !text(container).includes("Bash(git status:*)"),
      focused: section?.contains(document.activeElement) ?? false,
    }).toEqual({ removed: true, focused: true });
  });

  test("a rule longer than its row is not cut: the whole text wraps", async () => {
    const long = `Bash(${"npm run very-long-script-name ".repeat(6).trim()}:*)`;
    const { store } = fakeStore({ "rules.list": [ok(long)], "rules.remove": [] });
    const { container } = view(store);
    await uiIdle();
    const code = container.querySelector("code");
    expect({
      text: code?.textContent,
      cut: code?.className.includes("truncate"),
    }).toEqual({ text: long, cut: false });
  });

  test("in pt-BR the loading line and the retry are in Portuguese", async () => {
    const list = pending();
    const { store } = fakeStore({ "rules.list": [list.promise], "rules.remove": [] });
    const { container } = view(store, "pt-BR");
    await uiIdle();
    expect(within(container).queryByRole("status", { name: "Carregando as regras" }) !== null).toBe(
      true,
    );
  });
});
