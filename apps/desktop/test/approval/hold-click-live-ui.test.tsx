import { afterEach, describe, expect, test } from "bun:test";
import { translator } from "../../src/i18n/index.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { waiter } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ApprovalCard } = await import("../../src/features/permissions/approval-card.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);
const settle = waiter(2000);

const NOW = Date.parse("2026-11-02T12:00:00.000Z");
type Resolution = { decision: "allow" | "deny"; message?: string };

function card(lang: "en" | "pt-BR", risk: "high" | undefined, resolution?: Resolution) {
  const calls: unknown[][] = [];
  const t = translator(lang);
  const ui = (res?: Resolution) => (
    <TContext.Provider value={t}>
      <ApprovalCard
        request={{
          requestId: "r1",
          toolName: "Bash",
          input: { command: "rm -rf build" },
          cwd: null,
          createdAt: null,
          ...(risk ? { risk } : {}),
        }}
        t={t}
        nowMs={NOW}
        holdMs={40}
        {...(res ? { resolution: res } : {})}
        onRespond={(...args: unknown[]) => {
          calls.push(args);
        }}
      />
    </TContext.Provider>
  );
  const view = render(ui(resolution));
  return { calls, answer: (res: Resolution) => view.rerender(ui(res)) };
}
/** What the live regions of the screen say now. */
const said = () =>
  screen
    .queryAllByRole("status")
    .map((el) => el.textContent ?? "")
    .join("|");
const hold = () => screen.queryByRole("button", { name: /Hold to approve|Segurar para aprovar/ });
const fire = (fn: () => void) =>
  act(async () => {
    fn();
  });

describe("a click on the Hold button is answered (issue #4162)", () => {
  test("Given a click with no hold, Then a status says a click does not approve, and nothing is sent", async () => {
    const { calls } = card("en", "high");
    await fire(() => {
      const button = hold();
      if (button) fireEvent.click(button);
    });
    expect(said()).toContain("A click does not approve");
    expect(calls).toHaveLength(0);
  });

  test("Given a press let go before its time, Then the hint shows and nothing is sent", async () => {
    const { calls } = card("en", "high");
    await fire(() => {
      const button = hold();
      if (!button) return;
      fireEvent.pointerDown(button);
      fireEvent.pointerUp(button);
      fireEvent.click(button);
    });
    expect(said()).toContain("A click does not approve");
    expect(calls).toHaveLength(0);
  });

  test("Given the button held its full time, Then it approves and the hint stays away", async () => {
    const { calls } = card("en", "high");
    await fire(() => {
      const button = hold();
      if (button) fireEvent.pointerDown(button);
    });
    await settle(() => calls.length === 1);
    await fire(() => {
      const button = hold();
      if (!button) return;
      fireEvent.pointerUp(button);
      fireEvent.click(button);
    });
    expect(calls).toEqual([["allow", undefined, undefined, undefined, true]]);
    expect(said()).not.toContain("does not approve");
  });

  test("Given a hold that ran long and then a plain click later, Then only the later click is answered", async () => {
    const { calls } = card("en", "high");
    await fire(() => {
      const button = hold();
      if (button) fireEvent.pointerDown(button);
    });
    await settle(() => calls.length === 1);
    await fire(() => {
      const button = hold();
      if (!button) return;
      fireEvent.pointerUp(button);
      fireEvent.click(button);
    });
    expect(said()).not.toContain("does not approve");
    await fire(() => {
      const button = hold();
      if (button) fireEvent.click(button);
    });
    expect(said()).toContain("A click does not approve");
    expect(calls).toHaveLength(1);
  });

  test("Given pt-BR, Then the hint is in Portuguese", async () => {
    card("pt-BR", "high");
    await fire(() => {
      const button = hold();
      if (button) fireEvent.click(button);
    });
    expect(said()).toContain("Um clique não aprova");
  });
});

describe("the outcome of a request is announced (issue #4162)", () => {
  test("Given a waiting card that is then answered, Then a status region says the outcome", async () => {
    const { answer } = card("en", undefined);
    expect(said()).not.toContain("approved");
    await fire(() => answer({ decision: "allow" }));
    expect(said()).toContain("approved");
  });

  test("Given a denial with a reason, Then the status says it", async () => {
    const { answer } = card("en", undefined);
    await fire(() => answer({ decision: "deny", message: "not now" }));
    expect(said()).toContain("not now");
  });

  test("Given a card that is already answered when it appears, Then the outcome is text but not announced", () => {
    card("en", undefined, { decision: "allow" });
    expect(screen.queryByText("approved")).not.toBeNull();
    expect(said()).not.toContain("approved");
  });
});
