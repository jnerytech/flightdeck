import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
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

function view(
  over: {
    images?: boolean;
    settings?: boolean;
    status?: "idle" | "running";
    model?: string;
    mode?: "default" | "plan" | "bypassPermissions";
  } = {},
) {
  return render(
    <SessionView
      title="s"
      session={{
        ...emptySession(),
        status: over.status ?? "idle",
        ...(over.model ? { model: over.model } : {}),
        ...(over.mode ? { permissionMode: over.mode } : {}),
      }}
      actions={actions}
      images={over.images ?? false}
      settings={over.settings ?? false}
    />,
  );
}

describe("chat-composer: the floating box", () => {
  test("the text box sits in a rounded card, with the status line under it", () => {
    view();
    const card = document.querySelector("[data-slot='composer-card']") as HTMLElement;
    expect(card).not.toBeNull();
    expect(within(card).getByRole("textbox", { name: "Mensagem" })).toBeTruthy();
    const status = document.querySelector("[data-slot='session-status']") as HTMLElement;
    expect(status).not.toBeNull();
    expect(card.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("+ opens the file chooser and a chosen image is attached like a pasted one", async () => {
    view({ images: true });
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    expect(input.accept).toContain("image/png");
    expect(input.getAttribute("aria-hidden")).toBe("true");
    const open = spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Anexar imagem" }));
    expect(open).toHaveBeenCalledTimes(1);
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "a.png", {
      type: "image/png",
    });
    await act(async () => {
      fireEvent.change(input, { target: { files: [png] } });
    });
    await waitFor(() => screen.getByRole("img", { name: "Imagem anexada 1" }));
  });

  test("without image support there is no + and no file input", () => {
    view({ images: false });
    expect(screen.queryByRole("button", { name: "Anexar imagem" })).toBeNull();
    expect(document.querySelector("input[type='file']")).toBeNull();
  });
});

describe("chat-composer: the status line", () => {
  test("it names the model and the permission mode, even when they cannot be changed", () => {
    view({ model: "claude-opus-5-5", mode: "bypassPermissions" });
    const status = screen.getByRole("group", { name: "Estado da sessão" });
    expect(within(status).getByText("claude-opus-5-5")).toBeTruthy();
    expect(within(status).getByText("Sem perguntas")).toBeTruthy();
    expect(within(status).queryByLabelText("Modo de permissão")).toBeNull();
  });

  test("with session settings the model and the mode are pickers inside the line", () => {
    view({ settings: true, model: "claude-opus-5-5", mode: "default" });
    const status = screen.getByRole("group", { name: "Estado da sessão" });
    expect(within(status).getByLabelText("Modo de permissão")).toBeTruthy();
    expect(within(status).getByLabelText("Modelo")).toBeTruthy();
  });

  test("a spinner shows while a turn runs and leaves when it ends", () => {
    const { rerender } = view({ status: "running" });
    expect(document.querySelector("[data-slot='session-spinner']")).not.toBeNull();
    rerender(
      <SessionView title="s" session={{ ...emptySession(), status: "idle" }} actions={actions} />,
    );
    expect(document.querySelector("[data-slot='session-spinner']")).toBeNull();
  });
});
