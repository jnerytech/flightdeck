import { afterEach, describe, expect, test } from "bun:test";
import { translator } from "../../src/i18n/index.ts";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SplitView } = await import("../../src/shared/layout/split-view.tsx");
const { SessionView } = await import("../../src/features/sessions/session-view.tsx");
const { ApprovalCard } = await import("../../src/features/permissions/approval-card.tsx");
const { emptySession } = await import("../../src/features/sessions/domain/session-state.ts");

afterEach(cleanup);

/**
 * Issue #2591: an Esc handler inside a detail did its own job but left the key unhandled, so it
 * bubbled to SplitView and closed the detail too (#2579). Each case counts what the handler did and
 * how many times the detail closed.
 */
function inDetail(detail: React.ReactNode) {
  const closes: string[] = [];
  render(
    <SplitView
      list={<p>lista</p>}
      detail={detail}
      empty={<p>nada aberto</p>}
      onClose={() => closes.push("closed")}
      labels={{ resize: "Redimensionar a lista", back: "Voltar à lista" }}
    />,
  );
  return closes;
}

async function pressEscape(element: HTMLElement) {
  await act(async () => {
    fireEvent.keyDown(element, { key: "Escape" });
  });
}

function session(status: "running" | "idle") {
  const interrupts: string[] = [];
  const actions = {
    send: async () => {},
    interrupt: async () => void interrupts.push("interrupt"),
    close: async () => {},
    resume: async () => {},
    respond: async () => {},
  };
  const closes = inDetail(
    <SessionView title="s" session={{ ...emptySession(), status }} actions={actions} />,
  );
  return { closes, interrupts };
}

describe("split-view-escape-handlers: an Esc a control handled does not also close the detail (issue #2591)", () => {
  test("Esc in the message box of a working session interrupts it once and keeps the detail", async () => {
    const { closes, interrupts } = session("running");
    await pressEscape(screen.getByRole("textbox", { name: "Mensagem" }));
    expect([interrupts, closes]).toEqual([["interrupt"], []]);
  });

  test("Esc in the message box of an idle session closes the detail once", async () => {
    const { closes, interrupts } = session("idle");
    await pressEscape(screen.getByRole("textbox", { name: "Mensagem" }));
    expect([interrupts, closes]).toEqual([[], ["closed"]]);
  });

  test("Esc on a focused approval card leaves the card and keeps the detail", async () => {
    const closes = inDetail(
      <ApprovalCard
        request={{
          requestId: "r1",
          toolName: "Bash",
          input: { command: "npm test" },
          cwd: "/repo",
          createdAt: "2026-10-29T12:00:00.000Z",
        }}
        t={translator("en")}
        nowMs={Date.parse("2026-10-29T12:01:00.000Z")}
        onRespond={() => {}}
      />,
    );
    const card = screen.getByRole("group", { name: "Request for Bash" });
    card.focus();
    await pressEscape(card);
    expect([document.activeElement === card, closes]).toEqual([false, []]);
  });
});
