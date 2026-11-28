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
async function openCard(
  answer: "pending" | "not-found" | "refused" | "refused-then-gone",
  language: "en" | "pt-BR" = "en",
) {
  let release: (() => void) | undefined;
  /** How many times the host was asked for the card. */
  let asks = 0;
  /** Answers of the lookups that are still out, by card id. */
  const out = new Map<string, () => void>();
  const host = await fakeHostStore(
    {
      "card.get": (payload: { cardId: string }) => {
        asks++;
        if (answer === "not-found" || (answer === "refused-then-gone" && asks > 1)) {
          throw new RequestError("card_not_found", "no such card");
        }
        if (answer === "refused" || answer === "refused-then-gone") {
          throw new RequestError("search_busy", "busy");
        }
        return new Promise((resolve) => {
          release = () => resolve(null);
          out.set(payload.cardId, () => resolve(null));
        });
      },
    },
    { hostId: "h1", language, fallback: {} },
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
    asks: () => asks,
    release: () => release?.(),
    answer: (cardId: string) => out.get(cardId)?.(),
    goTo: (cardId: string) => view.rerender(page(cardId)),
  };
}

const notFound = () => screen.queryByText("Card not found.");
const backButton = () => screen.queryByRole("button", { name: "Back to the board" });
const tryAgain = () => screen.queryByRole("button", { name: "Try again" });
const failure = () => screen.queryByRole("alert")?.textContent ?? "";

describe("card-not-found-ui", () => {
  test("while the host is still asked, the page is in its loading shape and does not say not found", async () => {
    await openCard("pending");
    await settleMaybe(() => screen.queryByRole("status", { name: "Loading card…" }) !== null, 3000);
    expect(screen.queryByRole("status", { name: "Loading card…" })).not.toBeNull();
    expect(notFound() === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("a card the host does not have says so, with a way back to the board", async () => {
    const page = await openCard("not-found");
    await settleMaybe(() => notFound() !== null, 3000);
    expect(notFound()).not.toBeNull();
    expect(screen.queryByRole("status", { name: "Loading card…" }) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
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
    expect(notFound() === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(screen.queryByRole("status", { name: "Loading card…" })).not.toBeNull();
    await act(async () => {
      page.answer("other");
    });
    await settleMaybe(() => notFound() !== null, 3000);
    expect(notFound()).not.toBeNull();
  });

  test("a host that refuses the card for another reason says it could not read it, not that the card is gone", async () => {
    await openCard("refused");
    expect(await settleMaybe(() => failure().includes("The card could not be read."), 3000)).toBe(
      true,
    );
    expect(failure().includes("Too many searches are running")).toBe(true);
    expect(notFound() === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(tryAgain() !== null).toBe(true);
    expect(backButton() !== null).toBe(true);
  });

  test("Back on a card that could not be read goes to the board", async () => {
    const page = await openCard("refused");
    expect(await settleMaybe(() => backButton() !== null, 3000)).toBe(true);
    await act(async () => {
      fireEvent.click(backButton() as HTMLElement);
    });
    expect(page.back).toEqual(["back"]);
  });

  test("Try again asks the host again, loads meanwhile and then says what the host answers", async () => {
    const page = await openCard("refused-then-gone");
    expect(await settleMaybe(() => tryAgain() !== null, 3000)).toBe(true);
    expect(page.asks()).toBe(1);
    await act(async () => {
      fireEvent.click(tryAgain() as HTMLElement);
    });
    expect(await settleMaybe(() => notFound() !== null, 3000)).toBe(true);
    expect(page.asks()).toBe(2);
    expect(failure()).toBe("");
  });

  test("in Portuguese the failure speaks Portuguese", async () => {
    await openCard("refused", "pt-BR");
    expect(
      await settleMaybe(() => failure().includes("Não foi possível ler o card."), 3000),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Tentar de novo" }) !== null).toBe(true);
  });
});
