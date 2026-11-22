import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle, settleMaybe } from "../wait.ts";
import { chooseFromCardMenu } from "./card-menu.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { CardRunForm } = await import("../../src/features/board/card-run-form.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const CARD = {
  id: "c1",
  projectId: "p1",
  title: "Cart screen",
  description: "",
  column: "in_progress",
  validationNote: null,
  prUrl: null,
  prState: null,
  sessionId: null,
  sessionStatus: null,
  queued: false,
  worktreePath: null,
} as never;

/** The words of each language: the menu button, the menu items and the dialogs they open. */
const WORDS = {
  en: {
    actions: "Actions for Cart screen",
    cancel: "Cancel",
    discard: "Discard",
    discardDialog: "Discard card",
    finish: "Finish…",
    finishDialog: "Finish this card",
    complete: "Complete",
    completeDialog: "Complete card",
    startWith: "Start with a workflow or persona…",
    startDialog: "Start card",
    openPr: "Open PR",
    prDialog: "PR description",
  },
  "pt-BR": {
    actions: "Ações de Cart screen",
    cancel: "Cancelar",
    discard: "Descartar",
    discardDialog: "Descartar card",
    finish: "Finalizar…",
    finishDialog: "Finalizar este card",
    complete: "Concluir",
    completeDialog: "Concluir card",
    startWith: "Iniciar com workflow ou persona…",
    startDialog: "Iniciar card",
    openPr: "Abrir PR",
    prDialog: "Descrição do PR",
  },
} as const;

function setup(language: "en" | "pt-BR", card: object = {}, watch = false) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.hostCommand = (async (_host: string, type: string) =>
    type === "workflow.list" ? { workflows: [] } : {}) as never;
  store.hostRequest = (async () => ({ ok: true, data: { text: null, ignored: null } })) as never;
  store.prWatch.describe = (async () => ({ text: "Adds the cart", redacted: 0 })) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <CardRunForm
        store={store}
        hostId="h1"
        card={{ ...(CARD as object), ...card } as never}
        features={{ bg: true, watch }}
        tab="conversation"
        canMerge={false}
        gateWaiting={false}
        onMerge={() => {}}
        arenaStart={null}
        onDiscarded={() => {}}
        onShowDiff={() => {}}
      />
    </TContext.Provider>,
  );
}

/** Whether the Actions button has the focus: a boolean, so a failed check never prints a DOM node. */
const actionsHasFocus = (name: string) => {
  const trigger = screen.queryByRole("button", { name });
  return trigger !== null && document.activeElement === trigger;
};

const dialog = (name: string) =>
  screen.queryByRole("dialog", { name }) ?? screen.queryByRole("alertdialog", { name });

/** Presses Cancel in the dialog and waits for it to go. */
async function cancel(name: string, cancelLabel: string) {
  await settle(() => dialog(name) !== null);
  const open = dialog(name);
  const button = open ? within(open).queryByRole("button", { name: cancelLabel }) : null;
  expect(button).not.toBeNull();
  await act(async () => {
    if (button) fireEvent.click(button);
  });
  await settle(() => dialog(name) === null);
}

describe("card-dialogs-focus-ui: Cancel or Escape in a dialog the Actions menu opens gives the focus back to Actions (#4272)", () => {
  for (const language of ["en", "pt-BR"] as const) {
    const words = WORDS[language];
    const kit = { act, fireEvent, screen };

    test(`the Discard confirm (${language})`, async () => {
      setup(language);
      await chooseFromCardMenu(kit, words.actions, words.discard);
      await cancel(words.discardDialog, words.cancel);
      expect(await settleMaybe(() => actionsHasFocus(words.actions))).toBe(true);
    });

    test(`the Complete confirm, reached from the Finish dialog (${language})`, async () => {
      setup(language);
      await chooseFromCardMenu(kit, words.actions, words.finish);
      await settle(() => dialog(words.finishDialog) !== null);
      const finish = dialog(words.finishDialog);
      const complete = finish
        ? within(finish).queryByRole("button", { name: words.complete })
        : null;
      expect(complete).not.toBeNull();
      await act(async () => {
        if (complete) fireEvent.click(complete);
      });
      await cancel(words.completeDialog, words.cancel);
      expect(await settleMaybe(() => actionsHasFocus(words.actions))).toBe(true);
    });

    test(`the Start with dialog (${language})`, async () => {
      setup(language);
      await chooseFromCardMenu(kit, words.actions, words.startWith);
      await cancel(words.startDialog, words.cancel);
      expect(await settleMaybe(() => actionsHasFocus(words.actions))).toBe(true);
    });

    test(`Escape on the Start with dialog (${language})`, async () => {
      setup(language);
      await chooseFromCardMenu(kit, words.actions, words.startWith);
      await settle(() => dialog(words.startDialog) !== null);
      await act(async () => {
        fireEvent.keyDown(dialog(words.startDialog) as HTMLElement, { key: "Escape" });
      });
      await settle(() => dialog(words.startDialog) === null);
      expect(await settleMaybe(() => actionsHasFocus(words.actions))).toBe(true);
    });

    test(`the PR description dialog (${language})`, async () => {
      setup(language, { worktreePath: "/w/cart" }, true);
      await chooseFromCardMenu(kit, words.actions, words.openPr);
      await cancel(words.prDialog, words.cancel);
      expect(await settleMaybe(() => actionsHasFocus(words.actions))).toBe(true);
    });
  }
});
