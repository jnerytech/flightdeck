import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { emptySession, applyEnvelope } = await import("../src/lib/session-state.ts");

afterEach(cleanup);

const PNG = [0x89, 0x50, 0x4e, 0x47];
const file = (type = "image/png", size = PNG.length) =>
  new File([new Uint8Array(size).fill(1).map((_, i) => PNG[i] ?? 1)], "x", { type });

function setup(images = true) {
  const sent: Array<{ text: string; images: unknown }> = [];
  const actions = {
    send: async (text: string, withImages?: unknown) =>
      void sent.push({ text, images: withImages }),
    interrupt: async () => {},
    close: async () => {},
    resume: async () => {},
    respond: async () => {},
  };
  render(
    <SessionView
      title="s"
      session={{ ...emptySession(), status: "idle" }}
      actions={actions}
      images={images}
    />,
  );
  return { sent, box: screen.getByRole("textbox", { name: "Mensagem" }) };
}

const paste = async (box: HTMLElement, ...files: File[]) => {
  await act(async () => {
    fireEvent.paste(box, { clipboardData: { files, items: [], getData: () => "" } });
  });
};
const drop = async (box: HTMLElement, ...files: File[]) => {
  await act(async () => {
    fireEvent.drop(box, { dataTransfer: { files, items: [], types: ["Files"] } });
  });
};

describe("composer-imagens: images in the message box", () => {
  test("a pasted image shows as a thumbnail the sender can remove", async () => {
    const { box } = setup();
    await paste(box, file());
    await waitFor(() => expect(screen.getByRole("img", { name: "Imagem anexada 1" })).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remover imagem 1" }));
    });
    expect(screen.queryByRole("img", { name: "Imagem anexada 1" })).toBeNull();
  });

  test("Enviar carries the text and the images, then the thumbnails go", async () => {
    const { box, sent } = setup();
    await paste(box, file());
    await waitFor(() => screen.getByRole("img", { name: "Imagem anexada 1" }));
    fireEvent.change(box, { target: { value: "olha isto" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    });
    expect(sent).toEqual([
      { text: "olha isto", images: [{ mediaType: "image/png", data: "iVBORw==" }] },
    ]);
    expect(screen.queryByRole("img", { name: "Imagem anexada 1" })).toBeNull();
  });

  test("an image alone is a message, and a dropped image counts like a pasted one", async () => {
    const { box, sent } = setup();
    await drop(box, file("image/jpeg"));
    await waitFor(() => screen.getByRole("img", { name: "Imagem anexada 1" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    });
    expect(sent).toEqual([{ text: "", images: [{ mediaType: "image/jpeg", data: "iVBORw==" }] }]);
  });

  test("dragging over the box is accepted only when the host takes images", () => {
    const withImages = setup(true);
    expect(fireEvent.dragOver(withImages.box, { dataTransfer: { types: ["Files"] } })).toBe(false);
    cleanup();
    const without = setup(false);
    expect(fireEvent.dragOver(without.box, { dataTransfer: { types: ["Files"] } })).toBe(true);
  });

  test("a refused file says why and attaches nothing", async () => {
    const { box } = setup();
    await paste(box, file("image/svg+xml"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Só PNG, JPEG, GIF e WebP."),
    );
    expect(screen.queryByRole("img", { name: "Imagem anexada 1" })).toBeNull();

    await paste(box, file("image/png", 5 * 1024 * 1024 + 1));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("A imagem passa de 5 MB."),
    );
  });

  test("a sixth image is refused with the limit", async () => {
    const { box } = setup();
    await paste(box, file(), file(), file(), file(), file());
    await waitFor(() => screen.getByRole("img", { name: "Imagem anexada 5" }));
    await paste(box, file());
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("No máximo 5 imagens por mensagem."),
    );
    expect(screen.queryByRole("img", { name: "Imagem anexada 6" })).toBeNull();
  });

  test("a host without session.images ignores pasted images", async () => {
    const { box } = setup(false);
    await paste(box, file());
    expect(screen.queryByRole("img", { name: "Imagem anexada 1" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("the conversation says how many images a sent message had", () => {
    const state = applyEnvelope(emptySession(), {
      seq: 1,
      sessionId: "s",
      ts: 1,
      event: { type: "message.user", text: "olha", images: 2 },
    } as never);
    expect(state.items[0]).toMatchObject({ kind: "user", text: "olha", images: 2 });
    render(
      <SessionView
        title="s"
        session={state}
        actions={{
          send: async () => {},
          interrupt: async () => {},
          close: async () => {},
          resume: async () => {},
          respond: async () => {},
        }}
      />,
    );
    expect(screen.getByText("Imagens: 2")).toBeTruthy();
  });
});
