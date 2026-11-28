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

const ACTIONS = "Actions for Cart screen";
const FINISH = "Finish…";
const FINISH_DIALOG = "Finish this card";

/**
 * The menu's enter and exit animations, as the stylesheet declares them in the app (`animate-in` and
 * `animate-out`). Radix keeps a closing menu mounted until its `animationend`, and happy-dom runs no
 * animation, so the test never sends that event: the menu stays in its exit, the way it does for
 * the 150 ms a real browser takes.
 */
function declareMenuAnimations() {
  const style = document.createElement("style");
  style.textContent = `
    [data-slot="dropdown-menu-content"][data-state="open"] { animation-name: enter; }
    [data-slot="dropdown-menu-content"][data-state="closed"] { animation-name: leave; }
  `;
  document.head.appendChild(style);
  return () => style.remove();
}

function setup() {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
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

/** Whether the menu is open, as booleans: a failed check never prints a DOM node. */
const menuOpen = () =>
  screen.queryByRole("button", { name: ACTIONS })?.getAttribute("aria-expanded") === "true" &&
  screen.queryByRole("menuitem", { name: FINISH }) !== null;

describe("card-menu-reopen-ui: the Actions menu opened again while the last one is still closing stays open (#4353)", () => {
  test("Actions pressed right after the Finish dialog closes opens the menu", async () => {
    const undo = declareMenuAnimations();
    try {
      setup();
      await chooseFromCardMenu({ act, fireEvent, screen }, ACTIONS, FINISH);
      await settle(() => screen.queryByRole("dialog", { name: FINISH_DIALOG }) !== null);
      await act(async () => {
        fireEvent.keyDown(screen.queryByRole("dialog", { name: FINISH_DIALOG }) as HTMLElement, {
          key: "Escape",
        });
      });
      await settle(() => screen.queryByRole("dialog", { name: FINISH_DIALOG }) === null);

      // The menu the Finish… item closed is still in its exit; the person presses Actions again.
      const trigger = screen.queryByRole("button", { name: ACTIONS });
      expect(trigger).not.toBeNull();
      await act(async () => {
        if (trigger) {
          fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
        }
      });

      expect(await settleMaybe(menuOpen, 1500)).toBe(true);
    } finally {
      undo();
    }
  });
});
