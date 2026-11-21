import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionView } = await import("../../src/features/sessions/session-view.tsx");
const { emptySession } = await import("../../src/features/sessions/domain/session-state.ts");

afterEach(cleanup);

/**
 * Issue #3813: the Send button (and Stop, when a turn ends) leaves the page while it holds the
 * focus. The focus goes back to the message box, so a keyboard person does not start over from
 * the top of the page; focus that was anywhere else stays where it was.
 */
function setup() {
  const actions = {
    send: async () => {},
    interrupt: async () => {},
    close: async () => {},
    resume: async () => {},
    respond: async () => {},
  };
  const view = (status: "running" | "idle") => (
    <>
      <button type="button">fora</button>
      <SessionView title="s" session={{ ...emptySession(), status }} actions={actions} />
    </>
  );
  const utils = render(view("idle"));
  const box = () => screen.queryByRole("textbox", { name: "Mensagem" }) as HTMLTextAreaElement;
  const button = (name: string) => screen.queryByRole("button", { name }) as HTMLElement;
  const turn = async (status: "running" | "idle") => {
    await act(async () => {
      utils.rerender(view(status));
    });
  };
  return { box, button, turn };
}

const focusedIs = (element: Element | null) => document.activeElement === element;

describe("composer focus when its buttons go away (#3813)", () => {
  test("after Send is pressed, the message box has the focus", async () => {
    const { box, button } = setup();
    fireEvent.change(box(), { target: { value: "oi" } });
    const send = button("Enviar");
    expect(send).not.toBeNull();
    await act(async () => {
      send.focus();
      fireEvent.click(send);
    });
    expect(button("Enviar") === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(focusedIs(box())).toBe(true);
  });

  test("when a turn ends while Stop has the focus, the message box has it", async () => {
    const { box, button, turn } = setup();
    await turn("running");
    const stop = button("Parar o turno");
    expect(stop).not.toBeNull();
    await act(async () => {
      stop.focus();
    });
    await turn("idle");
    expect(button("Parar o turno") === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(focusedIs(box())).toBe(true);
  });

  test("focus that was on another control stays there when the turn ends", async () => {
    const { box, button, turn } = setup();
    await turn("running");
    const other = button("fora");
    await act(async () => {
      other.focus();
    });
    await turn("idle");
    expect(focusedIs(other)).toBe(true);
    expect(focusedIs(box())).toBe(false);
  });
});
