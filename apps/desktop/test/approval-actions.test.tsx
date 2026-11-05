import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ApprovalActions } = await import("../src/components/approval/approval-actions.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");

afterEach(cleanup);

function view(risk?: "low" | "medium" | "high") {
  const answers: string[] = [];
  render(
    <TContext.Provider value={translator("en")}>
      <ApprovalActions
        {...(risk ? { risk } : {})}
        onApprove={() => answers.push("approve")}
        onDeny={() => answers.push("deny")}
      />
    </TContext.Provider>,
  );
  return answers;
}

// Issue #182: the tiles said Allow where every other screen says Approve, and they approved a
// high-risk request with one click. One component answers a request everywhere.
describe("approval-actions: one way to answer a request", () => {
  test("a request is answered with Approve and Deny", async () => {
    const answers = view("medium");
    const approve = screen.queryByRole("button", { name: en.approval.approve });
    const deny = screen.queryByRole("button", { name: en.approval.deny });
    expect([approve !== null, deny !== null]).toEqual([true, true]);
    await act(async () => {
      fireEvent.click(approve as HTMLElement);
      fireEvent.click(deny as HTMLElement);
    });
    expect(answers).toEqual(["approve", "deny"]);
  });

  test("a high-risk request is approved only by holding the button; a click does nothing", async () => {
    const answers = view("high");
    expect(screen.queryByRole("button", { name: en.approval.approve })).toBeNull();
    const hold = screen.queryByRole("button", { name: en.approval.hold });
    expect(hold).not.toBeNull();
    await act(async () => {
      fireEvent.click(hold as HTMLElement);
    });
    expect(answers).toEqual([]);
    expect(screen.queryByRole("button", { name: en.approval.deny })).not.toBeNull();
  });

  test("a tile's pending request carries its risk, so a high-risk one is held there too", async () => {
    const { pendingOf } = await import("../src/lib/tiles.ts");
    const { emptySession } = await import("../src/lib/session-state.ts");
    const session = {
      ...emptySession(),
      pending: ["r1"],
      items: [
        {
          kind: "permission" as const,
          seq: 1,
          requestId: "r1",
          toolName: "Bash",
          input: { command: "rm -rf build" },
          risk: "high" as const,
        },
      ],
    };
    // And what it would do, so the tile holds over what it shows (#245, M5).
    expect(pendingOf(session)).toEqual({
      requestId: "r1",
      toolName: "Bash",
      risk: "high",
      input: { command: "rm -rf build" },
    });
  });
});
