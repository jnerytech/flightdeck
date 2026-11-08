import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { emptySession } = await import("../src/lib/session-state.ts");

afterEach(cleanup);

const actions = {
  send: async () => {},
  interrupt: async () => {},
  close: async () => {},
  resume: async () => {},
  respond: async () => {},
  setMode: async () => {},
  setModel: async () => {},
};

const view = (fill: string | null, taken: () => void) => (
  <SessionView
    title="s"
    session={{ ...emptySession(), status: "idle" }}
    actions={actions}
    composerFill={fill}
    onComposerFilled={taken}
  />
);

const box = () => screen.getByRole("textbox", { name: "Mensagem" }) as HTMLTextAreaElement;

describe("composer-fill-ui: a review handed to the message box (#1146)", () => {
  test("the fill lands in the box, which takes the focus, and the box reports it taken once", async () => {
    let taken = 0;
    render(view("Revisão das mudanças:\n1. `a.ts` linha 1:", () => taken++));
    await act(async () => {});
    expect(box().value).toBe("Revisão das mudanças:\n1. `a.ts` linha 1:");
    expect(document.activeElement === box()).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(taken).toBe(1);
  });

  test("what the person had typed stays, and the fill goes after a blank line", async () => {
    let taken = 0;
    const { rerender } = render(view(null, () => taken++));
    await act(async () => {
      fireEvent.change(box(), { target: { value: "first, a question" } });
    });
    rerender(view("the review", () => taken++));
    await act(async () => {});
    expect(box().value).toBe("first, a question\n\nthe review");
    expect(taken).toBe(1);
  });

  test("no fill leaves the box as it was", async () => {
    let taken = 0;
    render(view(null, () => taken++));
    await act(async () => {});
    expect(box().value).toBe("");
    expect(taken).toBe(0);
  });
});
