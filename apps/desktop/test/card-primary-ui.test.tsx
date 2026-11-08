import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { CardRunForm } = await import("../src/components/card/card-run-form.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const idle = { sessionId: null, sessionStatus: null, queued: false, worktreePath: null };
const finished = { sessionId: "s1", sessionStatus: "ended", worktreePath: "/w" };
const card = (over: object = {}) =>
  ({
    id: "c1",
    projectId: "p1",
    title: "Cart screen",
    description: "",
    column: "in_progress",
    validationNote: null,
    prUrl: null,
    prState: null,
    ...idle,
    ...over,
  }) as never;

type Call = [string, string, unknown];

function setup(language: "en" | "pt-BR" = "en") {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const commands: Call[] = [];
  store.hostCommand = (async (hostId: string, type: string, payload: unknown) => {
    commands.push([hostId, type, payload]);
    return type === "workflow.list" ? { workflows: [] } : {};
  }) as never;
  store.hostRequest = (async () => ({ ok: true, data: { text: null, ignored: null } })) as never;
  const seen = { shown: 0, back: 0, merged: 0 };
  const form = (over: object, tab: "conversation" | "diff" = "conversation", canMerge = false) => (
    <TContext.Provider value={store.i18n.t}>
      <CardRunForm
        store={store}
        hostId="h1"
        card={card(over)}
        features={{ bg: true, watch: false }}
        tab={tab}
        canMerge={canMerge}
        onMerge={() => {
          seen.merged++;
        }}
        arenaStart={null}
        onDiscarded={() => {
          seen.back++;
        }}
        onShowDiff={() => {
          seen.shown++;
        }}
      />
    </TContext.Provider>
  );
  return { store, commands, seen, form };
}

const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    if (el) fireEvent.click(el);
  });
};
const button = (name: string | RegExp) => screen.queryByRole("button", { name });
const openMenu = async (label = "Actions for Cart screen") => {
  const trigger = button(label);
  expect(trigger).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(trigger as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
  });
};
const item = (name: string) => screen.queryByRole("menuitem", { name });
/** The names of the buttons the run panel shows without opening anything. */
const shown = () =>
  Array.from(document.querySelectorAll('[data-slot="card-run"] button')).map(
    (el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
  );

describe("card-primary-ui: the card leads with one button for its next step (#1197)", () => {
  test("a card that never started shows Start and the menu, and nothing else", async () => {
    const w = setup();
    render(w.form({}));
    expect(shown()).toEqual(["Start", "Actions for Cart screen"]);
    await click(button("Start"));
    await settle(() => w.commands.some(([, type]) => type === "card.start"));
    expect(w.commands.filter(([, type]) => type === "card.start")).toEqual([
      ["h1", "card.start", { cardId: "c1" }],
    ]);
  });

  test("the rest sits under the menu: the other ways to start, Finish and Discard", async () => {
    const w = setup();
    render(w.form({}));
    await openMenu();
    expect(
      [
        item("Start with a workflow or persona…"),
        item("Start in the background"),
        item("Finish…"),
        item("Discard"),
      ].map((el) => el !== null),
    ).toEqual([true, true, true, true]);
    expect([item("Stop"), item("Open PR")].map((el) => el === null)).toEqual([true, true]);
  });

  test("Start with a workflow or persona… opens the start dialog", async () => {
    const w = setup();
    render(w.form({}));
    await openMenu();
    await click(item("Start with a workflow or persona…"));
    await settle(() => screen.queryByRole("dialog", { name: "Start card" }) !== null);
    expect(screen.queryByRole("dialog", { name: "Start card" })).not.toBeNull();
  });

  test("a running card leads with Stop, which stops it", async () => {
    const w = setup();
    render(w.form({ ...finished, sessionStatus: "running" }));
    expect(shown()).toEqual(["Stop", "Actions for Cart screen"]);
    await click(button("Stop"));
    await settle(() => w.commands.some(([, type]) => type === "card.stop"));
    expect(w.commands.filter(([, type]) => type === "card.stop")).toEqual([
      ["h1", "card.stop", { cardId: "c1" }],
    ]);
  });

  const open = { prUrl: "https://github.com/acme/repo/pull/1", prState: "open" };

  test("a card with an open PR that can be merged leads with Merge PR, which asks to merge", async () => {
    const w = setup();
    render(w.form({ ...finished, ...open }, "conversation", true));
    expect(shown()).toEqual(["Merge PR", "Actions for Cart screen"]);
    await click(button("Merge PR"));
    expect(w.seen.merged).toBe(1);
  });

  test("a PR that cannot be merged (its checks fail, or the host cannot merge) leads with nothing", () => {
    const w = setup();
    render(w.form({ ...finished, ...open }, "conversation", false));
    expect(shown()).toEqual(["Actions for Cart screen"]);
  });

  test("a running card with an open PR keeps Merge PR in the menu, behind Stop", async () => {
    const w = setup();
    render(w.form({ ...finished, ...open, sessionStatus: "running" }, "conversation", true));
    expect(shown()).toEqual(["Stop", "Actions for Cart screen"]);
    await openMenu();
    await click(item("Merge PR"));
    expect(w.seen.merged).toBe(1);
  });

  test("a finished run leads with Review changes, which shows the changes; Open PR waits in the menu", async () => {
    const w = setup();
    render(w.form(finished));
    expect(shown()).toEqual(["Review changes", "Actions for Cart screen"]);
    await click(button("Review changes"));
    expect(w.seen.shown).toBe(1);
    await openMenu();
    expect(item("Open PR") === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("with the changes on show it leads with Open PR, which opens the PR", async () => {
    const w = setup();
    render(w.form(finished, "diff"));
    expect(shown()).toEqual(["Open PR", "Actions for Cart screen"]);
    await click(button("Open PR"));
    await settle(() => w.commands.some(([, type]) => type === "card.pr.create"));
    expect(w.commands.filter(([, type]) => type === "card.pr.create")).toEqual([
      ["h1", "card.pr.create", { cardId: "c1" }],
    ]);
  });

  test("a card whose PR is open has no primary button here and no Open PR in the menu", async () => {
    const w = setup();
    render(w.form({ ...finished, prUrl: "https://x/pr/1", prState: "open" }));
    expect(shown()).toEqual(["Actions for Cart screen"]);
    await openMenu();
    expect(item("Open PR") === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(item("Finish…") === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("an idle session can still be stopped from the menu, and a card that ran can start again", async () => {
    const w = setup();
    render(w.form({ ...finished, sessionStatus: "idle" }));
    expect(shown()).toEqual(["Review changes", "Actions for Cart screen"]);
    await openMenu();
    expect(item("Stop") === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    await click(item("Stop"));
    await settle(() => w.commands.some(([, type]) => type === "card.stop"));
    expect(w.commands.filter(([, type]) => type === "card.stop")).toEqual([
      ["h1", "card.stop", { cardId: "c1" }],
    ]);
  });

  test("a card whose run ended starts again from the menu in one step, with no Stop to offer", async () => {
    const w = setup();
    render(w.form(finished));
    await openMenu();
    expect(item("Stop") === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    await click(item("Start"));
    await settle(() => w.commands.some(([, type]) => type === "card.start"));
    expect(w.commands.filter(([, type]) => type === "card.start")).toEqual([
      ["h1", "card.start", { cardId: "c1" }],
    ]);
  });

  test("the primary is one button whose name changes, so the focus stays on it", async () => {
    const w = setup();
    const view = render(w.form(finished));
    const lead = button("Review changes");
    expect(lead).not.toBeNull();
    lead?.focus();
    view.rerender(w.form(finished, "diff"));
    expect(document.activeElement === lead).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(lead?.textContent?.trim()).toBe("Open PR");
    view.rerender(w.form({ ...finished, sessionStatus: "running" }, "diff"));
    expect(document.activeElement === lead).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(lead?.textContent?.trim()).toBe("Stop");
  });

  test("Discard from the menu asks first, and the confirm discards the card", async () => {
    const w = setup();
    render(w.form(finished));
    await openMenu();
    await click(item("Discard"));
    await settle(() => screen.queryByRole("button", { name: "Discard card" }) !== null);
    await click(button("Discard card"));
    await settle(() => w.seen.back === 1);
    expect(w.commands.filter(([, type]) => type === "card.discard")).toEqual([
      ["h1", "card.discard", { cardId: "c1", confirm: true }],
    ]);
  });

  test("the menu opens from the keyboard", async () => {
    const w = setup();
    render(w.form({}));
    const trigger = button("Actions for Cart screen") as HTMLElement;
    expect(trigger).not.toBeNull();
    trigger?.focus();
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    await settle(() => item("Discard") !== null);
    expect(item("Discard") === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("in Portuguese the buttons and the menu speak Portuguese", async () => {
    const w = setup("pt-BR");
    render(w.form(finished));
    expect(shown()).toEqual(["Revisar mudanças", "Ações de Cart screen"]);
    await openMenu("Ações de Cart screen");
    expect(item("Abrir PR") === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(item("Iniciar com workflow ou persona…") === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(item("Descartar") === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });
});
