import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const {
  act,
  cleanup,
  fireEvent,
  render,
  within,
  waitFor: rtlWaitFor,
} = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });

/** The confirmation's button with `name` (the dialog is an alertdialog), clicked. */
async function confirmWith(name: string) {
  const dialog = screen.queryByRole("alertdialog");
  expect(dialog).not.toBeNull();
  const button = within(dialog as HTMLElement).queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
}

/** A host's menu in the sidebar, opened (Radix opens on pointer down). */
async function openHostMenu(host: string) {
  const trigger = screen.queryByRole("button", { name: `Menu de ${host}` });
  expect(trigger).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(trigger as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
  });
}
const { AppStore } = await import("../src/lib/app-store.ts");
const { emptySession } = await import("../src/lib/session-state.ts");
const { App } = await import("../src/ui/App.tsx");
const { SessionView } = await import("../src/ui/SessionView.tsx");
type SessionState = import("../src/lib/session-state.ts").SessionState;

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });

function setup() {
  const d = makeDaemon(cleanups);
  const server = d.listen();
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 10 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  return { ...d, server, store, ...mem };
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function addHost(url: string) {
  type("Nome", "meu pc");
  type("Endereço", "127.0.0.1");
  type("Porta", new URL(url.replace("ws://", "http://")).port);
  type("Token", TOKEN);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Testar e adicionar" }));
  });
  await waitFor(() => expect(screen.getByLabelText("meu pc: online")).toBeTruthy());
}

async function newSession(prompt: string, name = "minha sessão") {
  await sidebar.hostAction("Nova sessão", "meu pc");
  const folder = screen.getByLabelText("Pasta") as HTMLSelectElement;
  fireEvent.change(folder, { target: { value: folder.options[0]?.value } });
  type("Subpasta", "p");
  type("Nome", name);
  fireEvent.change(screen.getByLabelText("Modo de permissão"), { target: { value: "default" } });
  type("Primeiro prompt", prompt);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Criar sessão" }));
  });
}

describe("desktop: interface", () => {
  test("adiciona host, cria sessão e conversa", async () => {
    const { server } = setup();
    expect(screen.getByText(/Adicione um host/)).toBeTruthy();
    await addHost(server.url);
    await newSession("olá **mundo**");
    await waitFor(() => expect(screen.getAllByText("ociosa").length).toBeGreaterThan(0));
    expect(screen.getByRole("heading", { name: "minha sessão" })).toBeTruthy();
    expect(screen.getAllByText(/Echo: olá/).length).toBeGreaterThan(0);

    type("Mensagem", "segunda");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    });
    await waitFor(() => expect(screen.getAllByText("Echo: segunda")).toHaveLength(1));
    expect((screen.getByLabelText("Mensagem") as HTMLTextAreaElement).value).toBe("");
  });

  test("card de aprovação com diff: permitir e negar com motivo", async () => {
    const { server } = setup();
    await addHost(server.url);
    await newSession("[tool]");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Aprovar" })).not.toBeNull());
    expect(screen.getAllByText("Write").length).toBeGreaterThan(0);
    expect(screen.getByText("+ conteúdo de teste")).toBeTruthy();
    expect(screen.getAllByText("esperando você").length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));
    });
    await waitFor(() => expect(screen.getByText("aprovado")).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/arquivo criado/)).toBeTruthy());

    type("Mensagem", "[tool] outra vez");
    fireEvent.keyDown(screen.getByLabelText("Mensagem"), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Negar" })).toBeTruthy());
    // The reason opens after Negar (phase 10); a second Negar sends it.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Negar" }));
    });
    type("Motivo (opcional)", "aqui não");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Negar" }));
    });
    await waitFor(() => expect(screen.getByText("negado: aqui não")).toBeTruthy());
  });

  test("interromper, encerrar, retomar, erro e remover host", async () => {
    const { server, store } = setup();
    await addHost(server.url);
    await newSession("[tool]");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Aprovar" })).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Interromper" }));
    });
    await waitFor(() => expect(screen.getByText("cancelado")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Encerrar" }));
    });
    // Ending a session asks first (phase 10).
    await confirmWith("Encerrar sessão");
    await waitFor(() => expect(screen.getByRole("button", { name: "Retomar" })).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retomar" }));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Encerrar" })).toBeTruthy());

    // The new-session form from the host's menu, and back to the session from Sessões.
    await sidebar.hostAction("Nova sessão", "meu pc");
    expect(screen.getByRole("button", { name: "Criar sessão" })).toBeTruthy();
    await sidebar.openHub();
    fireEvent.click(screen.getByRole("button", { name: "minha sessão" }));
    expect(screen.getByRole("heading", { name: "minha sessão" })).toBeTruthy();

    await act(async () => {
      await store.createSession(store.getState().hosts[0]?.id ?? "", { cwd: "/fora", prompt: "x" });
    });
    // The error is a toast, titled by its code (phase 10); Fechar closes it.
    await waitFor(() =>
      expect(screen.queryByRole("alert")?.textContent ?? "").toContain(
        "A pasta está fora das pastas permitidas do host.",
      ),
    );
    const toast = screen.queryByRole("alert") as HTMLElement;
    fireEvent.click(within(toast).getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Adicionar outro host" }));
    expect(screen.getByRole("button", { name: "Testar e adicionar" })).toBeTruthy();
    await openHostMenu("meu pc");
    const remove = screen.queryByRole("menuitem", { name: "Remover host" });
    expect(remove).not.toBeNull();
    await act(async () => {
      fireEvent.click(remove as HTMLElement);
    });
    await confirmWith("Remover host");
    await waitFor(() => expect(screen.queryByLabelText("meu pc: online")).toBeNull());
  });

  test("formulário de host exige todos os campos", async () => {
    const { store } = setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Testar e adicionar" }));
    });
    expect(store.getState().hosts).toHaveLength(0);
  });
});

describe("desktop: tela de sessão", () => {
  const noop = async () => {};
  const actions = { send: noop, interrupt: noop, close: noop, resume: noop, respond: noop };

  test("mostra texto em streaming, resultado com custo, erro e pedidos expirados", () => {
    const session: SessionState = {
      ...emptySession(),
      status: "error",
      statusReason: "daemon reiniciado",
      cwd: "/proj/demo",
      streaming: "parcial…",
      toolResults: { t1: { content: "falhou feio", isError: true } },
      items: [
        {
          kind: "assistant",
          seq: 1,
          blocks: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }],
        },
        {
          kind: "assistant",
          seq: 2,
          blocks: [{ type: "tool_use", id: "t2", name: "Read", input: "estranho" }],
        },
        {
          kind: "permission",
          seq: 3,
          requestId: "r",
          toolName: "Bash",
          input: { command: "rm -rf /" },
          resolution: { decision: "expired" },
        },
        {
          kind: "result",
          seq: 4,
          subtype: "success",
          isError: false,
          durationMs: 1500,
          costUsd: 0.0123,
        },
        {
          kind: "result",
          seq: 5,
          subtype: "error_during_execution",
          isError: true,
          durationMs: 10,
        },
        { kind: "error", seq: 6, code: "runtime", message: "explodiu" },
      ],
    };
    render(<SessionView title="demo" session={session} actions={actions} />);
    expect(screen.getByText("parcial…")).toBeTruthy();
    expect(screen.getByText("expirado")).toBeTruthy();
    expect(screen.getByText(/turno concluído · 1\.5 s · US\$ 0\.0123/)).toBeTruthy();
    expect(screen.getByText(/turno com erro · 0\.0 s/)).toBeTruthy();
    expect(screen.getByText("runtime: explodiu")).toBeTruthy();
    expect(screen.getByText("daemon reiniciado")).toBeTruthy();
    expect(screen.getByText("falhou feio")).toBeTruthy();
    expect(screen.getByText("Read")).toBeTruthy();
    expect(screen.getByText("aguardando resultado…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retomar" })).toBeTruthy();
  });

  test("mensagem vazia não é enviada", () => {
    const sent: string[] = [];
    render(
      <SessionView
        title="demo"
        session={{ ...emptySession(), status: "idle" }}
        actions={{ ...actions, send: async (t) => void sent.push(t) }}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText("Mensagem"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(sent).toEqual([]);
  });
});
