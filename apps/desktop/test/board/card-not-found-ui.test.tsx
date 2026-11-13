import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore } from "../fake-host.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { CardDetail } = await import("../../src/features/board/card-detail.tsx");
const { RequestError } = await import("../../src/features/hosts/host-connection.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * #2599: a card page whose card is not found used to be one bare line, with no loading state while
 * the host was still asked and no way back. It now loads, then says so and offers the board.
 */
async function openCard(answer: "pending" | "not-found") {
  let release: (() => void) | undefined;
  /** Answers of the lookups that are still out, by card id. */
  const out = new Map<string, () => void>();
  const host = await fakeHostStore(
    {
      "card.get": (payload: { cardId: string }) => {
        if (answer === "not-found") throw new RequestError("not_found", "no such card");
        return new Promise((resolve) => {
          release = () => resolve(null);
          out.set(payload.cardId, () => resolve(null));
        });
      },
    },
    { hostId: "h1", language: "en", fallback: {} },
  );
  host.store.i18n.start();
  const back: string[] = [];
  const page = (cardId: string) => (
    <TContext.Provider value={host.store.i18n.t}>
      <CardDetail
        store={host.store}
        hostId="h1"
        cardId={cardId}
        onOpenSettings={() => {}}
        onOpenWorkflows={() => {}}
        onBack={() => back.push("back")}
        onOpenCard={() => {}}
      />
    </TContext.Provider>
  );
  const view = render(page("missing"));
  return {
    back,
    release: () => release?.(),
    answer: (cardId: string) => out.get(cardId)?.(),
    goTo: (cardId: string) => view.rerender(page(cardId)),
  };
}

const notFound = () => screen.queryByText("Card not found.");
const backButton = () => screen.queryByRole("button", { name: "Back to the board" });

describe("card-not-found-ui", () => {
  test("while the host is still asked, the page is in its loading shape and does not say not found", async () => {
    await openCard("pending");
    await settleMaybe(() => screen.queryByRole("status", { name: "Loading card…" }) !== null, 3000);
    expect(screen.queryByRole("status", { name: "Loading card…" })).not.toBeNull();
    expect(notFound() === null).toBe(true);
  });

  test("a card the host does not have says so, with a way back to the board", async () => {
    const page = await openCard("not-found");
    await settleMaybe(() => notFound() !== null, 3000);
    expect(notFound()).not.toBeNull();
    expect(screen.queryByRole("status", { name: "Loading card…" }) === null).toBe(true);
    expect(backButton()).not.toBeNull();
    await act(async () => {
      fireEvent.click(backButton() as HTMLElement);
    });
    expect(page.back).toEqual(["back"]);
  });

  test("a host that answers nothing for the card ends the loading too", async () => {
    const page = await openCard("pending");
    await act(async () => {
      page.release();
    });
    await settleMaybe(() => notFound() !== null, 3000);
    expect(notFound()).not.toBeNull();
    expect(backButton()).not.toBeNull();
  });

  test("an answer for the card the page left does not end the loading of the card it is on now", async () => {
    const page = await openCard("pending");
    await settleMaybe(() => screen.queryByRole("status", { name: "Loading card…" }) !== null, 3000);
    await act(async () => {
      page.goTo("other");
    });
    await act(async () => {
      page.answer("missing");
    });
    await settleMaybe(() => notFound() !== null, 400);
    expect(notFound() === null).toBe(true);
    expect(screen.queryByRole("status", { name: "Loading card…" })).not.toBeNull();
    await act(async () => {
      page.answer("other");
    });
    await settleMaybe(() => notFound() !== null, 3000);
    expect(notFound()).not.toBeNull();
  });
});
