import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { en } from "../../src/i18n/en.ts";
import { ptBR } from "../../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle, settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { CardStartDialog } = await import("../../src/features/board/card-start-dialog.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const CARD = { id: "c1", projectId: "p1", title: "Cart screen" };
const WORKFLOW = {
  name: "triage",
  trusted: true,
  errors: [],
  inputs: [],
};

/** What a host answers to `card.start`: the card, or a refusal. */
type StartAnswer = { ok: true; data: unknown } | { ok: false; code: string; message: string };

/** The dialog with a `workflow.list` that answers as the test says; every command is recorded. */
function setup(
  lang: "en" | "pt-BR",
  list: () => Promise<unknown>,
  startAnswers: StartAnswer[] = [{ ok: true, data: {} }],
) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const commands: Array<[string, unknown]> = [];
  const calls = { closed: 0, started: 0 };
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    commands.push([type, payload]);
    return type === "workflow.list" ? list() : {};
  }) as never;
  // A refusal comes back to the dialog, not to the banner (#4462).
  store.hostRequest = (async (_host: string, type: string, payload: unknown) => {
    commands.push([type, payload]);
    return startAnswers.shift() ?? { ok: true, data: {} };
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <CardStartDialog
        store={store}
        hostId="h1"
        card={CARD}
        onClose={() => {
          calls.closed++;
        }}
        onStarted={() => {
          calls.started++;
        }}
      />
    </TContext.Provider>,
  );
  return { commands, calls };
}

const starts = (commands: Array<[string, unknown]>) =>
  commands.filter(([type]) => type === "card.start");

for (const [lang, t, start] of [
  ["en", en, en.cardUi.start],
  ["pt-BR", ptBR, ptBR.cardUi.start],
] as const) {
  describe(`card-start-dialog-ui (${lang}): the start dialog (#3827)`, () => {
    test("it names the card, and Start waits for the workflow list with its reason in plain sight", async () => {
      let release: (value: unknown) => void = () => undefined;
      const w = setup(
        lang,
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      expect(screen.queryByText(t.board.startFor.replace("{title}", CARD.title))).not.toBeNull();
      expect(screen.queryByText(t.board.startLoading)).not.toBeNull();
      const button = screen.queryByRole("button", { name: start }) as HTMLButtonElement | null;
      expect(button?.disabled).toBe(true);
      await act(async () => {
        if (button) fireEvent.click(button);
      });
      expect(starts(w.commands)).toEqual([]);
      await act(async () => release({ workflows: [WORKFLOW] }));
      await settle(
        () => !(screen.queryByRole("button", { name: start }) as HTMLButtonElement).disabled,
      );
      expect(screen.queryByText(t.board.startLoading) === null).toBe(true); // NOSONAR: a boolean keeps a DOM node out of the failure diff
      await act(async () => {
        fireEvent.click(screen.queryByRole("button", { name: start }) as HTMLElement);
      });
      await settle(() => starts(w.commands).length === 1);
    });

    test("the workflow select has a visible label that names it (#3878)", async () => {
      setup(lang, async () => ({ workflows: [WORKFLOW] }));
      await settle(() => screen.queryByRole("combobox", { name: t.cardUi.workflow }) !== null);
      const label = screen.queryByText(t.cardUi.workflow);
      expect(label?.tagName).toBe("LABEL");
      const select = screen.queryByRole("combobox", { name: t.cardUi.workflow });
      expect(label?.getAttribute("for")).toBe(select?.id);
    });

    test("a list that could not be read says so, keeps Start off and offers a retry or starting without", async () => {
      const answers: unknown[] = [null, { workflows: [WORKFLOW] }];
      const w = setup(lang, async () => answers.shift() ?? null);
      await settle(() => screen.queryByText(t.board.startWorkflowsFailed) !== null);
      expect((screen.queryByRole("button", { name: start }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      await act(async () => {
        fireEvent.click(screen.queryByRole("button", { name: t.board.startRetry }) as HTMLElement);
      });
      await settle(
        () => !(screen.queryByRole("button", { name: start }) as HTMLButtonElement).disabled,
      );
      expect(screen.queryByText(t.board.startWorkflowsFailed) === null).toBe(true); // NOSONAR: a boolean keeps a DOM node out of the failure diff
      expect(starts(w.commands)).toEqual([]);
    });

    test("when the list stays unreadable, starting without a workflow is a choice the person makes", async () => {
      const w = setup(lang, async () => null);
      await settle(() => screen.queryByText(t.board.startWorkflowsFailed) !== null);
      await act(async () => {
        fireEvent.click(
          screen.queryByRole("button", { name: t.board.startWithout }) as HTMLElement,
        );
      });
      await settle(
        () => !(screen.queryByRole("button", { name: start }) as HTMLButtonElement).disabled,
      );
      await act(async () => {
        fireEvent.click(screen.queryByRole("button", { name: start }) as HTMLElement);
      });
      await settle(() => starts(w.commands).length === 1);
      expect(starts(w.commands)).toEqual([["card.start", { cardId: "c1" }]]);
    });
    test("a refused start leaves the dialog open, the typed inputs in place and the reason in it, and Start asks the host again (#4462)", async () => {
      const alertFlow = { ...WORKFLOW, name: "triage-alert", inputs: ["alert"] };
      const w = setup(lang, async () => ({ workflows: [alertFlow] }), [
        { ok: false, code: "card_refused", message: "The project has no folder" },
        { ok: true, data: {} },
      ]);
      await settle(
        () => !(screen.queryByRole("button", { name: start }) as HTMLButtonElement).disabled,
      );
      const typed = "What: login fails\nWhere: the cart\nWhy: a new build";
      await act(async () => {
        fireEvent.change(
          screen.queryByRole("combobox", { name: t.cardUi.workflow }) as HTMLElement,
          {
            target: { value: "triage-alert" },
          },
        );
      });
      const field = () =>
        screen.queryByRole("textbox", {
          name: t.cardUi.input.replace("{name}", "alert"),
        }) as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(field(), { target: { value: typed } });
      });
      await act(async () => {
        fireEvent.click(screen.queryByRole("button", { name: start }) as HTMLElement);
      });
      await settle(() => starts(w.commands).length === 1);
      await settleMaybe(() => screen.queryByRole("alert") !== null);
      expect({
        closed: w.calls.closed,
        started: w.calls.started,
        inputs: field().value,
        reasonShown: (screen.queryByRole("alert")?.textContent ?? "").includes(
          "The project has no folder",
        ),
      }).toEqual({ closed: 0, started: 0, inputs: typed, reasonShown: true });
      // The second press asks the host again; it accepts, and only then does the dialog close.
      await settle(
        () => !(screen.queryByRole("button", { name: start }) as HTMLButtonElement).disabled,
      );
      await act(async () => {
        fireEvent.click(screen.queryByRole("button", { name: start }) as HTMLElement);
      });
      await settle(() => starts(w.commands).length === 2);
      await settle(() => w.calls.started === 1);
      expect(w.calls).toEqual({ closed: 1, started: 1 });
    });

    test("an accepted start closes the dialog and tells the caller, once (#4462)", async () => {
      const w = setup(lang, async () => ({ workflows: [WORKFLOW] }));
      await settle(
        () => !(screen.queryByRole("button", { name: start }) as HTMLButtonElement).disabled,
      );
      await act(async () => {
        fireEvent.click(screen.queryByRole("button", { name: start }) as HTMLElement);
      });
      await settle(() => w.calls.started === 1);
      expect(w.calls).toEqual({ closed: 1, started: 1 });
    });

    test("while the list loads, Start names the loading line as its reason (#4462)", async () => {
      setup(lang, () => new Promise(() => undefined));
      const loading = screen.queryByText(t.board.startLoading);
      const button = screen.queryByRole("button", { name: start }) as HTMLButtonElement | null;
      expect({
        disabled: button?.disabled,
        linked: Boolean(loading?.id) && button?.getAttribute("aria-describedby") === loading?.id,
      }).toEqual({ disabled: true, linked: true });
    });
  });
}
