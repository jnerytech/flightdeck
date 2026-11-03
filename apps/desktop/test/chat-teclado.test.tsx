import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { emptySession } = await import("../src/lib/session-state.ts");

afterEach(cleanup);

function setup(status: "running" | "idle" = "idle") {
  const sent: string[] = [];
  const actions = {
    send: async (text: string) => void sent.push(text),
    interrupt: async () => {},
    close: async () => {},
    resume: async () => {},
    respond: async () => {},
  };
  render(<SessionView title="s" session={{ ...emptySession(), status }} actions={actions} />);
  const box = () => screen.getByRole("textbox", { name: "Mensagem" }) as HTMLTextAreaElement;
  const type = (value: string) => fireEvent.change(box(), { target: { value } });
  return { sent, box, type };
}

describe("chat-teclado: Enter sends, Ctrl+Enter breaks the line", () => {
  test("Enter sends the message and clears the box", async () => {
    const { sent, box, type } = setup();
    type("olá");
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Enter" });
    });
    expect(sent).toEqual(["olá"]);
    expect(box().value).toBe("");
  });

  test("Ctrl+Enter and Shift+Enter send nothing; Ctrl+Enter adds a new line where the cursor is", async () => {
    const { sent, box, type } = setup();
    type("ab");
    box().setSelectionRange(1, 1);
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    });
    expect(sent).toEqual([]);
    expect(box().value).toBe("a\nb");
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    });
    expect(sent).toEqual([]);
  });

  test("Enter while an input method is composing does not send", async () => {
    const { sent, box, type } = setup();
    type("に");
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Enter", isComposing: true });
    });
    expect(sent).toEqual([]);
  });

  test("Enter during a turn queues the message instead of sending it", async () => {
    const { sent, box, type } = setup("running");
    type("depois");
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Enter" });
    });
    expect(sent).toEqual([]);
    expect(screen.getByRole("list", { name: "Na fila" })).toBeTruthy();
    expect(screen.getByText("depois")).toBeTruthy();
  });

  test("the box says Enter sends, announces it, and asks for / commands", () => {
    const { box } = setup();
    expect(box().getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(box().placeholder).toBe("Digite / para comandos");
    expect(box().title).toBe("Enter envia · Ctrl+Enter quebra a linha");
  });
});

describe("chat-teclado: the send icon", () => {
  test("it shows only when the box has text, and sends like Enter", async () => {
    const { sent, type } = setup();
    expect(screen.queryByRole("button", { name: "Enviar" })).toBeNull();
    type("oi");
    const button = screen.getByRole("button", { name: "Enviar" });
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Enter");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(sent).toEqual(["oi"]);
    expect(screen.queryByRole("button", { name: "Enviar" })).toBeNull();
  });
});
