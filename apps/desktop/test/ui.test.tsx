import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { unregisterDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

// Loaded after dom.ts registered the DOM globals: RTL and react-dom read them on import.
const {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor: rtlWaitFor,
} = await import("@testing-library/react");
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
afterAll(() => unregisterDom());

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
  type("URL", url);
  type("Token", TOKEN);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Adicionar host" }));
  });
  await waitFor(() => expect(screen.getByLabelText("meu pc: online")).toBeTruthy());
}

async function newSession(prompt: string, name = "minha sessão") {
  fireEvent.click(screen.getByRole("button", { name: "Nova sessão em meu pc" }));
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
    await waitFor(() => expect(screen.getAllByText("Echo: segunda").length).toBe(1));
    expect((screen.getByLabelText("Mensagem") as HTMLTextAreaElement).value).toBe("");
  });

  test("card de aprovação com diff: permitir e negar com motivo", async () => {
    const { server } = setup();
    await addHost(server.url);
    await newSession("[tool]");
    await waitFor(() => expect(screen.getByRole("button", { name: "Permitir" })).toBeTruthy());
    expect(screen.getAllByText("Write").length).toBeGreaterThan(0);
    expect(screen.getByText("+ conteúdo de teste")).toBeTruthy();
    expect(screen.getAllByText("esperando você").length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Permitir" }));
    });
    await waitFor(() => expect(screen.getByText("permitido")).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/arquivo criado/)).toBeTruthy());

    type("Mensagem", "[tool] outra vez");
    fireEvent.keyDown(screen.getByLabelText("Mensagem"), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Negar" })).toBeTruthy());
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Permitir" })).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Interromper" }));
    });
    await waitFor(() => expect(screen.getByText("cancelado")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Encerrar" }));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Retomar" })).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retomar" }));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Encerrar" })).toBeTruthy());

    // Selecting another session from the sidebar and back.
    fireEvent.click(screen.getByRole("button", { name: "Nova sessão em meu pc" }));
    expect(screen.getByRole("button", { name: "Criar sessão" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /minha sessão/ }));
    expect(screen.getByRole("heading", { name: "minha sessão" })).toBeTruthy();

    await act(async () => {
      await store.createSession(store.getState().hosts[0]?.id ?? "", { cwd: "/fora", prompt: "x" });
    });
    expect(screen.getByRole("alert").textContent).toContain("forbidden_cwd");
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Adicionar outro host" }));
    expect(screen.getByRole("button", { name: "Adicionar host" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remover meu pc" }));
    });
    await waitFor(() => expect(screen.queryByLabelText("meu pc: online")).toBeNull());
  });

  test("formulário de host exige todos os campos", async () => {
    const { store } = setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Adicionar host" }));
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
    expect(screen.getByText(/1\.5 s · US\$ 0\.0123/)).toBeTruthy();
    expect(screen.getByText(/error_during_execution/)).toBeTruthy();
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
