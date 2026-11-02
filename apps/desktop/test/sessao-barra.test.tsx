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
};
const box = () => screen.queryByLabelText("Mensagem") as HTMLTextAreaElement;
const press = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => void fireEvent.click(button as HTMLElement));
};

describe("sessao-barra: the composer toolbar", () => {
  test("Inserir um snippet opens the snippet list, as typing / does", async () => {
    const prompts = {
      list: async () => [{ key: "k", name: "revisar" }],
      fill: async () => "texto do snippet",
    };
    render(
      <SessionView
        title="s"
        session={{ ...emptySession(), status: "idle" }}
        actions={actions}
        prompts={prompts}
      />,
    );
    await press("Inserir um snippet");
    expect(box().value).toBe("/");
    await act(async () => {});
    expect(screen.queryByRole("option", { name: "revisar" })).not.toBeNull();
    await act(async () => void fireEvent.click(screen.queryByRole("option") as HTMLElement));
    expect(box().value).toBe("texto do snippet");
  });

  test("without snippets there is no snippet button, and without a picker no mention button", () => {
    render(
      <SessionView title="s" session={{ ...emptySession(), status: "idle" }} actions={actions} />,
    );
    expect(screen.queryByRole("button", { name: "Inserir um snippet" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mencionar arquivo ou pasta" })).toBeNull();
  });

  test("Mencionar arquivo ou pasta opens the picker and puts the chosen folder in the message as @path", async () => {
    render(
      <SessionView
        title="s"
        session={{ ...emptySession(), status: "idle" }}
        actions={actions}
        pickPath={(done) => (
          <div role="dialog" aria-label="picker">
            <button type="button" onClick={() => done("/repo/src")}>
              pick
            </button>
            <button type="button" onClick={() => done(null)}>
              cancel
            </button>
          </div>
        )}
      />,
    );
    await act(async () => void fireEvent.change(box(), { target: { value: "olhe " } }));
    await press("Mencionar arquivo ou pasta");
    expect(screen.queryByRole("dialog", { name: "picker" })).not.toBeNull();
    await press("pick");
    expect(screen.queryByRole("dialog", { name: "picker" })).toBeNull();
    expect(box().value).toBe("olhe @/repo/src ");
    await press("Mencionar arquivo ou pasta");
    await press("cancel");
    expect(box().value).toBe("olhe @/repo/src ");
  });

  test("a managed session on a host that announces settings has a mode and a model select", async () => {
    const calls: string[] = [];
    const a = {
      ...actions,
      setMode: async (mode: string) => void calls.push(`mode:${mode}`),
      setModel: async (model: string | null) => void calls.push(`model:${model}`),
    };
    render(
      <SessionView
        title="s"
        session={{ ...emptySession(), status: "idle", permissionMode: "default" }}
        actions={a}
        settings
      />,
    );
    const mode = screen.queryByLabelText("Modo de permissão") as HTMLSelectElement;
    expect(mode.value).toBe("default");
    await act(async () => void fireEvent.change(mode, { target: { value: "plan" } }));
    const model = screen.queryByLabelText("Modelo") as HTMLSelectElement;
    await act(async () => void fireEvent.change(model, { target: { value: "opus" } }));
    await act(async () => void fireEvent.change(model, { target: { value: "" } }));
    expect(calls).toEqual(["mode:plan", "model:opus", "model:null"]);
  });

  test("without settings (an older host, a terminal session) there are no selects", () => {
    render(
      <SessionView title="s" session={{ ...emptySession(), status: "idle" }} actions={actions} />,
    );
    expect(screen.queryByLabelText("Modo de permissão")).toBeNull();
    expect(screen.queryByLabelText("Modelo")).toBeNull();
  });

  test("typing / also offers the slash commands of the session, and one fills the box", async () => {
    render(
      <SessionView
        title="s"
        session={{ ...emptySession(), status: "idle", slashCommands: ["compact", "review"] }}
        actions={actions}
      />,
    );
    await act(async () => void fireEvent.change(box(), { target: { value: "/co" } }));
    await act(async () => {});
    expect(screen.queryByRole("option", { name: "/review" })).toBeNull();
    await act(async () => void fireEvent.click(screen.getByRole("option", { name: "/compact" })));
    expect(box().value).toBe("/compact ");
  });

  test("the mode select offers only modes as strict as the one the session started with", () => {
    const options = (permissionMode: "plan" | "default" | "acceptEdits") => {
      const view = render(
        <SessionView
          title="s"
          session={{ ...emptySession(), status: "idle", permissionMode }}
          actions={{ ...actions, setMode: async () => {} }}
          settings
        />,
      );
      const names = [
        ...(screen.queryByLabelText("Modo de permissão") as HTMLSelectElement).options,
      ].map((o) => o.value);
      view.unmount();
      return names;
    };
    expect(options("plan")).toEqual(["plan"]);
    expect(options("default")).toEqual(["plan", "default"]);
    expect(options("acceptEdits")).toEqual(["plan", "default", "acceptEdits"]);
  });
});
