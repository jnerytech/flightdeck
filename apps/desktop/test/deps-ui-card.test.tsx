import { afterEach, describe, expect, test } from "bun:test";
import type { Card, WorkflowInfo } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { CardDeps } = await import("../src/ui/CardDeps.tsx");

afterEach(cleanup);

const card = {
  id: "c1",
  projectId: "p",
  title: "B",
  column: "backlog",
  arenaOf: null,
  blockedBy: ["a"],
  blocking: [],
  waitingOn: ["a"],
  unblockWhen: "done",
  autoStart: { workflow: null },
  unblockedAt: null,
  position: 1,
} as unknown as Card;
const blocker = { ...card, id: "a", title: "A", blockedBy: [], waitingOn: [], autoStart: null };
const workflows = [{ name: "feature" }, { name: "review" }] as unknown as WorkflowInfo[];

function show(sent: Array<{ type: string; payload: unknown }>) {
  const store = {
    hostCommand: async (_host: string, type: string, payload: unknown) => {
      sent.push({ type, payload });
      return null;
    },
  };
  render(
    <TContext.Provider value={translator("en")}>
      <CardDeps
        store={store as never}
        hostId="h"
        card={card}
        cards={[card, blocker]}
        workflows={workflows}
      />
    </TContext.Provider>,
  );
}

describe("deps-ui: the auto-start's workflow", () => {
  test("the workflow of the auto-start is chosen, and none sends no workflow", async () => {
    const sent: Array<{ type: string; payload: unknown }> = [];
    show(sent);
    const picker = screen.queryByLabelText("Auto-start workflow");
    expect(picker).not.toBeNull();
    await act(async () => {
      fireEvent.change(picker as HTMLElement, { target: { value: "feature" } });
    });
    await act(async () => {
      fireEvent.change(picker as HTMLElement, { target: { value: "" } });
    });
    expect(sent).toEqual([
      { type: "card.update", payload: { cardId: "c1", autoStart: { workflow: "feature" } } },
      { type: "card.update", payload: { cardId: "c1", autoStart: { workflow: null } } },
    ]);
  });
});
