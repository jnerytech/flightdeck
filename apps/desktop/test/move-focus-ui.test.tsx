import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Card } from "@flightdeck/protocol";
import { useRef } from "react";
import { registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, render } = await import("@testing-library/react");
const { useMoveFocus } = await import("../src/hooks/use-move-focus.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * #1546: a card made from the New card dialog is focused once it shows. A card that never shows must
 * not leave the target armed, or it takes the focus from wherever the person is when it appears.
 */
const made = { id: "c1", column: "backlog", position: 0 } as unknown as Card;

function Board(props: Readonly<{ cards: Card[]; until: number }>) {
  const board = useRef<HTMLDivElement>(null);
  const wanted = useRef<{
    cardId: string;
    column: "backlog";
    index: number;
    until?: number;
  } | null>({
    cardId: "c1",
    column: "backlog",
    index: -1,
    until: props.until,
  });
  useMoveFocus(wanted, {
    cards: props.cards,
    columnOf: () => props.cards,
    board,
    narrow: false,
    showing: "backlog",
    onShow: () => {},
  });
  return (
    <div ref={board}>
      <button type="button">Elsewhere</button>
      {props.cards.map((card) => (
        <ul key={card.id}>
          <li data-card={card.id}>
            <button type="button" data-card-open>
              Open {card.id}
            </button>
          </li>
        </ul>
      ))}
    </div>
  );
}

describe("move-focus-ui: a card made is focused once it shows, and not after its time has passed (#1546)", () => {
  test("the card shows in time: it takes the focus", async () => {
    const { rerender, container } = render(<Board cards={[]} until={Date.now() + 5000} />);
    await act(async () => {
      rerender(<Board cards={[made]} until={Date.now() + 5000} />);
    });
    expect(document.activeElement === container.querySelector("[data-card-open]")).toBe(true);
  });

  test("the card shows after the time has passed: the focus stays where the person put it", async () => {
    const { rerender, container } = render(<Board cards={[]} until={Date.now() - 1} />);
    const elsewhere = container.querySelector<HTMLElement>("button");
    elsewhere?.focus();
    await act(async () => {
      rerender(<Board cards={[made]} until={Date.now() - 1} />);
    });
    expect(document.activeElement === elsewhere).toBe(true);
  });
});
