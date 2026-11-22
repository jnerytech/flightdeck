import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle } from "../wait.ts";
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

const LABELS = {
  en: { actions: "Actions for Cart screen", finish: "Finish…", dialog: "Finish this card" },
  "pt-BR": { actions: "Ações de Cart screen", finish: "Finalizar…", dialog: "Finalizar este card" },
} as const;

function setup(language: "en" | "pt-BR") {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.hostCommand = (async (_host: string, type: string) =>
    type === "workflow.list" ? { workflows: [] } : {}) as never;
  store.hostRequest = (async () => ({ ok: true, data: { text: null, ignored: null } })) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <CardRunForm
        store={store}
        hostId="h1"
        card={CARD}
        features={{ bg: true, watch: false }}
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

describe("card-finish-focus-ui: the focus goes back to Actions when the Finish dialog closes (#4262)", () => {
  for (const language of ["en", "pt-BR"] as const) {
    const words = LABELS[language];
    test(`Escape on the dialog gives the focus back to the Actions button (${language})`, async () => {
      setup(language);
      await chooseFromCardMenu({ act, fireEvent, screen }, words.actions, words.finish);
      await settle(() => screen.queryByRole("dialog", { name: words.dialog }) !== null);
      await act(async () => {
        fireEvent.keyDown(screen.queryByRole("dialog", { name: words.dialog }) as HTMLElement, {
          key: "Escape",
        });
      });
      await settle(() => screen.queryByRole("dialog", { name: words.dialog }) === null);
      // Radix hands the focus back in a timer of its own: let it run.
      await act(async () => {
        await new Promise((done) => setTimeout(done, 50));
      });
      expect(actionsHasFocus(words.actions)).toBe(true);
    });
  }
});
