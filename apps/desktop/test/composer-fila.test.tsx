import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { emptySession } = await import("../src/lib/session-state.ts");

afterEach(cleanup);

function setup(images = false, failures = 0) {
  const sent: Array<{ text: string; images: unknown }> = [];
  let failing = failures;
  const actions = {
    send: async (text: string, withImages?: unknown) => {
      sent.push({ text, images: withImages });
      if (failing-- > 0) throw new Error("host unreachable");
    },
    interrupt: async () => {},
    close: async () => {},
    resume: async () => {},
    respond: async () => {},
  };
  const view = (status: "running" | "idle") => (
    <SessionView
      title="s"
      session={{ ...emptySession(), status }}
      actions={actions}
      images={images}
    />
  );
  const utils = render(view("running"));
  const box = () => screen.getByRole("textbox", { name: "Mensagem" }) as HTMLTextAreaElement;
  const queue = async (text: string) => {
    fireEvent.change(box(), { target: { value: text } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enfileirar" }));
    });
  };
  const turn = async (status: "running" | "idle") => {
    await act(async () => {
      utils.rerender(view(status));
    });
  };
  return { sent, box, queue, turn };
}

describe("composer-fila: messages queued while a turn runs", () => {
  test("a message written during a turn waits in a list instead of going out", async () => {
    const { sent, box, queue } = setup();
    await queue("primeiro");
    expect(sent).toEqual([]);
    expect(box().value).toBe("");
    expect(screen.getByRole("list", { name: "Na fila" })).toBeTruthy();
    expect(screen.getByText("primeiro")).toBeTruthy();
  });

  test("Enter during a turn queues too", async () => {
    const { sent, box } = setup();
    fireEvent.change(box(), { target: { value: "pelo teclado" } });
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Enter" });
    });
    expect(sent).toEqual([]);
    expect(
      within(screen.getByRole("list", { name: "Na fila" })).getByText("pelo teclado"),
    ).toBeTruthy();
  });

  test("a queued message can be removed, or taken back to the box to edit", async () => {
    const { box, queue } = setup();
    await queue("um");
    await queue("dois");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remover da fila: um" }));
    });
    expect(screen.queryByText("um")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Editar da fila: dois" }));
    });
    expect(box().value).toBe("dois");
    expect(screen.queryByRole("list", { name: "Na fila" })).toBeNull();
  });

  test("when the turn ends the queue goes out in order, one message per turn", async () => {
    const { sent, queue, turn } = setup();
    await queue("um");
    await queue("dois");
    await turn("idle");
    await waitFor(() => expect(sent.map((m) => m.text)).toEqual(["um"]));
    await turn("running");
    expect(sent.map((m) => m.text)).toEqual(["um"]);
    expect(screen.queryByText("um")).toBeNull();
    expect(screen.getByText("dois")).toBeTruthy();
    await turn("idle");
    await waitFor(() => expect(sent.map((m) => m.text)).toEqual(["um", "dois"]));
    await turn("running");
    expect(screen.queryByRole("list", { name: "Na fila" })).toBeNull();
  });

  test("a queued message keeps its images", async () => {
    const { sent, box, turn } = setup(true);
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "a.png", {
      type: "image/png",
    });
    await act(async () => {
      fireEvent.paste(box(), { clipboardData: { files: [png], items: [], getData: () => "" } });
    });
    await waitFor(() => screen.getByRole("img", { name: "Imagem anexada 1" }));
    fireEvent.change(box(), { target: { value: "com imagem" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enfileirar" }));
    });
    await turn("idle");
    await waitFor(() =>
      expect(sent).toEqual([
        { text: "com imagem", images: [{ mediaType: "image/png", data: "iVBORw==" }] },
      ]),
    );
  });

  test("a send that fails keeps the message in the queue, and the next idle turn tries it again", async () => {
    const { sent, queue, turn } = setup(false, 1);
    await queue("importante");
    await turn("idle");
    await waitFor(() => expect(sent.map((m) => m.text)).toEqual(["importante"]));
    // It failed: the message is still waiting in the list.
    expect(
      within(screen.getByRole("list", { name: "Na fila" })).getByText("importante"),
    ).toBeTruthy();
    await turn("running");
    await turn("idle");
    await waitFor(() => expect(sent.map((m) => m.text)).toEqual(["importante", "importante"]));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Na fila" })).toBeNull());
  });
});
