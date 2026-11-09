import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, stays } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { RequestError } = await import("../src/lib/host-connection.ts");
const { Notices } = await import("../src/components/feedback/notices.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * #1546 (round 14 of #168): Open the PR with this text closed its dialog and the host refused it; the
 * refusal showed in a toast and the focus stayed on the page body. A command the person gave that the
 * host refuses puts the focus on the refusal's message, when the step lost it.
 */
function setup() {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  (store as unknown as { dispatch: unknown }).dispatch = async () => {
    throw new RequestError("invalid_state", "The PR cannot be opened.");
  };
  render(
    <>
      <h1 data-slot="page-title" tabIndex={-1}>
        The page
      </h1>
      <button type="button">Elsewhere</button>
      <Notices store={store} />
    </>,
  );
  return store;
}

const alert = () => screen.queryByRole("alert");

describe("refusal-focus-ui: a refused command puts the focus on its message (#1546)", () => {
  test("the dialog that gave the command is gone and the focus with it: it goes to the refusal", async () => {
    const store = setup();
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => {
      await store.hostCommand("h1", "card.pr.create", { cardId: "c1" } as never, {
        focusRefusal: true,
      });
    });
    await settle(() => alert() !== null, 5000, "the refusal toast");
    await settle(() => document.activeElement === alert(), 5000, "focus on the refusal");
    expect(document.activeElement === alert()).toBe(true);
  });

  test("focus on a control that stays is left where it is", async () => {
    const store = setup();
    const other = screen.queryByRole("button", { name: "Elsewhere" });
    other?.focus();
    await act(async () => {
      await store.hostCommand("h1", "card.pr.create", { cardId: "c1" } as never, {
        focusRefusal: true,
      });
    });
    await settle(() => alert() !== null, 5000, "the refusal toast");
    await stays(() => document.activeElement === other, 300, "focus stays on the control");
  });

  test("an error that no command of the person's caused does not take the focus", async () => {
    const store = setup();
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => {
      (store as unknown as { fail(error: unknown): void }).fail(new Error("the link dropped"));
    });
    await settle(() => alert() !== null, 5000, "the error toast");
    await stays(() => document.activeElement !== alert(), 300, "focus is not taken");
  });

  test("a refusal of a command the person did not give (a background load) does not take the focus", async () => {
    const store = setup();
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => {
      await store.hostCommand("h1", "workflow.list", { projectId: "p1" } as never);
    });
    await settle(() => alert() !== null, 5000, "the refusal toast");
    await stays(() => document.activeElement !== alert(), 300, "focus is not taken");
  });

  test("closing a refusal that holds the focus gives it to the page's heading, not to the body", async () => {
    const store = setup();
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => {
      await store.hostCommand("h1", "card.pr.create", { cardId: "c1" } as never, {
        focusRefusal: true,
      });
    });
    await settle(() => document.activeElement === alert(), 5000, "focus on the refusal");
    await act(async () => {
      const close = within(alert() as HTMLElement).queryByRole("button", { name: "Close" });
      if (close) fireEvent.click(close);
    });
    const heading = document.querySelector("[data-slot=page-title]");
    await settle(() => document.activeElement === heading, 5000, "focus on the heading");
    expect(document.activeElement === heading).toBe(true);
  });
});
