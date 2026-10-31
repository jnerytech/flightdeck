import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { git, gitRepo } from "../../daemon/test/board-helpers.ts";
import { AppStore, sessionKey } from "../src/lib/app-store.ts";
import { WORKSPACE_KEY } from "../src/lib/workspace.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { App } = await import("../src/ui/App.tsx");

// Real git, a daemon and a fake runtime: more than the default 5 s.
setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const YAML = `setup: ["prepare"]
run:
  - name: web
    cmd: ["serve", "--port", "{{port.web}}"]
    ready: { http: "http://127.0.0.1:{{port.web}}/" }
ports: [web]
`;
const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

/** Waits briefly for a condition and answers whether it held: the `expect` after it decides. */
async function until(check: () => unknown, ms = 1500): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await Bun.sleep(10);
  }
  return Boolean(check());
}

/** A host with a project whose run.yaml is committed, and a card with its worktree. */
async function setup() {
  const d = makeDaemon(cleanups, { runenv: true });
  const { repo } = gitRepo("run-app");
  // The repo must be inside the daemon's allowed root.
  const inside = join(d.root, "run-app");
  git(d.root, "clone", "-q", repo, inside);
  git(inside, "config", "commit.gpgsign", "false");
  mkdirSync(join(inside, ".flightdeck"), { recursive: true });
  writeFileSync(join(inside, ".flightdeck", "run.yaml"), YAML);
  git(inside, "add", ".flightdeck");
  git(inside, "commit", "-q", "-m", "run.yaml");
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, {
    baseDelayMs: 10,
    maxDelayMs: 20,
  });
  cleanups.push(() => store.dispose());
  const hostId = await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
  await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.status === "online");
  const project = await store.hostCommand(hostId, "project.add", { path: inside });
  const created = await store.hostCommand(hostId, "card.create", {
    projectId: project?.id ?? "",
    title: "Rodar",
    description: "faça",
  });
  const cardId = created?.id ?? "";
  await store.hostCommand(hostId, "card.start", { cardId });
  await waitFor(() => d.board.getCard(cardId).worktreePath);
  return {
    ...d,
    store,
    hostId,
    projectId: project?.id ?? "",
    cardId,
    key: sessionKey(hostId, cardId),
  };
}

describe("run-ui: o estado do Run na loja", () => {
  test("o run.yaml do projeto vem com o hash, e só se confia no hash revisado", async () => {
    const { store, hostId, projectId } = await setup();
    const info = await store.runEnvConfig(hostId, projectId);
    expect(info).toMatchObject({ exists: true, hash: sha256(YAML), trusted: false, errors: [] });
    expect(info?.config?.ports).toEqual(["web"]);
    const trusted = await store.runTrust(hostId, projectId, sha256(YAML));
    expect(trusted?.trusted).toBe(true);
  });

  test("Run sobe o setup e os processos, e a loja guarda o estado de cada mudança até o Stop", async () => {
    const { store, hostId, projectId, cardId, key, runHost } = await setup();
    await store.runTrust(hostId, projectId, sha256(YAML));
    expect(store.getState().runEnvs[key]).toBeUndefined();
    await store.runStart(hostId, cardId);
    expect(await until(() => store.getState().runEnvs[key]?.status === "setup")).toBe(true);
    runHost?.finish("term-1", 0);
    expect(await until(() => store.getState().runEnvs[key]?.status === "running")).toBe(true);
    expect(store.getState().runEnvs[key]?.ports).toEqual({ web: 41000 });
    expect(store.getState().runEnvs[key]?.processes.map((p) => [p.name, p.url])).toEqual([
      ["web", "http://127.0.0.1:41000/"],
    ]);
    expect(await until(() => store.getState().runEnvs[key]?.processes[0]?.ready === "ready")).toBe(
      true,
    );
    await store.runStop(hostId, cardId);
    expect(await until(() => store.getState().runEnvs[key]?.status === "ended")).toBe(true);
    expect(runHost?.spawned.at(-1)?.killed).toBe(true);
  });

  test("um Run recusado (run.yaml não confiado) vai para o aviso e não deixa estado", async () => {
    const { store, hostId, cardId, key } = await setup();
    await store.runStart(hostId, cardId);
    expect(store.getState().runEnvs[key]).toBeUndefined();
    expect(store.getState().error ?? "").toContain("não confiado");
  });
});

describe("run-ui: o preview em uma aba", () => {
  /** The app with one host (without any, every screen is the form that adds the first). */
  async function shown() {
    const d = makeDaemon(cleanups);
    const mem = memoryPlatform(false, "pt-BR");
    const opened: string[] = [];
    mem.win.open = (url) => {
      opened.push(String(url));
      return null;
    };
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
    });
    return { store, opened, items: mem.items };
  }
  const frame = () => document.querySelector("iframe");

  test("a rota preview mostra o app do card num quadro e o botão abre o mesmo endereço no navegador", async () => {
    const { store, opened } = await shown();
    await act(async () => {
      store.tabs.open({ name: "preview", url: "http://127.0.0.1:41000/", title: "web" });
    });
    expect(frame()?.getAttribute("src")).toBe("http://127.0.0.1:41000/");
    expect(frame()?.getAttribute("title")).toBe("Preview de web");
    const button = screen.queryByRole("button", { name: "Abrir no navegador" });
    expect(button).not.toBeNull();
    await act(async () => {
      if (button) fireEvent.click(button);
    });
    expect(opened).toEqual(["http://127.0.0.1:41000/"]);
    expect(screen.queryAllByRole("tab").map((tab) => tab.textContent)).toContain("web");
  });

  test("um endereço fora do loopback não abre quadro nem botão: a tela recusa", async () => {
    const { store, opened } = await shown();
    await act(async () => {
      store.tabs.open({ name: "preview", url: "http://example.com/", title: "fora" });
    });
    expect(frame()).toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir no navegador" })).toBeNull();
    expect(screen.queryByText("Só endereços de 127.0.0.1 e localhost abrem aqui.")).not.toBeNull();
    expect(opened).toEqual([]);
  });

  test("a aba de preview não volta ao reabrir o app: o endereço pode ser de outro programa agora", async () => {
    const { store, items } = await shown();
    await act(async () => {
      store.tabs.open({ name: "preview", url: "http://127.0.0.1:41000/", title: "web" });
    });
    const kept = JSON.parse(items.get(WORKSPACE_KEY) ?? "null");
    expect(JSON.stringify(kept)).not.toContain("41000");
    const next = new AppStore(memoryPlatform(false, "pt-BR").platform);
    expect(next.workspace.tabs.router.current.name).toBe("home");
  });

  test("a CSP do app deixa quadros só em http(s) 127.0.0.1 e localhost", () => {
    const conf = JSON.parse(
      readFileSync(resolve(import.meta.dir, "../src-tauri/tauri.conf.json"), "utf8"),
    ) as { app: { security: { csp: string } } };
    const csp = conf.app.security.csp;
    const directive = csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("frame-src"));
    expect(directive).toBe(
      "frame-src http://127.0.0.1:* http://localhost:* https://127.0.0.1:* https://localhost:*",
    );
    expect(csp).toContain("default-src 'self'");
  });
});

describe("run-ui: Run e Stop no card", () => {
  /** The card's screen of a host whose project has the committed run.yaml. */
  async function cardScreen(trusted = false) {
    const ctx = await setup();
    if (trusted) await ctx.store.runTrust(ctx.hostId, ctx.projectId, sha256(YAML));
    render(<App store={ctx.store} />);
    await act(async () => {
      ctx.store.router.push({
        name: "card",
        host: ctx.hostId,
        projectId: ctx.projectId,
        cardId: ctx.cardId,
      });
    });
    return ctx;
  }
  const panel = () => screen.queryByRole("region", { name: "Ambiente de execução" });
  const inPanel = () => within(panel() as HTMLElement);
  const press = async (name: string) => {
    const button = panel() ? inPanel().queryByRole("button", { name }) : null;
    expect(button).not.toBeNull();
    await act(async () => {
      if (button) fireEvent.click(button);
    });
  };
  /** Waits for what the panel shows, answering whether it did. */
  const shows = (check: () => boolean) => until(check, 3000);

  test("com o run.yaml ainda não confiado, o painel lista os comandos e só o Confiar libera o Run", async () => {
    await cardScreen();
    expect(await shows(() => panel() !== null)).toBe(true);
    expect(inPanel().queryByText("prepare")).not.toBeNull();
    expect(inPanel().queryByText("serve --port {{port.web}}")).not.toBeNull();
    expect(inPanel().queryByRole("button", { name: "Run" })).toBeNull();
    await press("Confiar neste run.yaml");
    const dialog = screen.queryByRole("alertdialog");
    expect(dialog).not.toBeNull();
    const confirm = within(dialog as HTMLElement).queryByRole("button", { name: "Confiar" });
    expect(confirm).not.toBeNull();
    await act(async () => {
      if (confirm) fireEvent.click(confirm);
    });
    expect(
      await shows(
        () => panel() !== null && inPanel().queryByRole("button", { name: "Run" }) !== null,
      ),
    ).toBe(true);
    expect(inPanel().queryByRole("button", { name: "Confiar neste run.yaml" })).toBeNull();
  });

  test("Cancelar na pergunta de confiança não confia em nada: o Run continua fora", async () => {
    await cardScreen();
    expect(await shows(() => panel() !== null)).toBe(true);
    await press("Confiar neste run.yaml");
    const cancel = within(screen.getByRole("alertdialog")).queryByRole("button", {
      name: "Cancelar",
    });
    expect(cancel).not.toBeNull();
    await act(async () => {
      if (cancel) fireEvent.click(cancel);
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(inPanel().queryByRole("button", { name: "Confiar neste run.yaml" })).not.toBeNull();
    expect(inPanel().queryByRole("button", { name: "Run" })).toBeNull();
  });

  test("Run mostra o setup, depois cada processo com o log e o preview; Stop encerra tudo", async () => {
    const { store, hostId, runHost } = await cardScreen(true);
    expect(
      await shows(
        () => panel() !== null && inPanel().queryByRole("button", { name: "Run" }) !== null,
      ),
    ).toBe(true);
    await press("Run");
    expect(
      await shows(() => panel() !== null && inPanel().queryByText("Preparando (setup)…") !== null),
    ).toBe(true);
    expect(inPanel().queryByRole("button", { name: "Run" })).toBeNull();
    runHost?.finish("term-1", 0);
    expect(await shows(() => panel() !== null && inPanel().queryByText("web") !== null)).toBe(true);
    expect(inPanel().queryByText("Portas: web 41000")).not.toBeNull();
    expect(inPanel().queryByText("rodando")).not.toBeNull();
    // The log is the process's terminal tab.
    await press("Ver log de web");
    expect(store.router.current).toMatchObject({ name: "terminal", host: hostId });
    await act(async () => {
      store.tabs.activate(store.tabs.tabs[0]?.id ?? "");
    });
    // The preview opens once the process answers (the fixture's wait answers at once).
    expect(
      await shows(
        () =>
          panel() !== null &&
          inPanel().queryByRole("button", { name: "Abrir preview de web" }) !== null,
      ),
    ).toBe(true);
    await press("Abrir preview de web");
    expect(store.router.current).toEqual({
      name: "preview",
      url: "http://127.0.0.1:41000/",
      title: "web",
    });
    await act(async () => {
      store.tabs.activate(store.tabs.tabs[0]?.id ?? "");
    });
    expect(
      await shows(
        () => panel() !== null && inPanel().queryByRole("button", { name: "Stop" }) !== null,
      ),
    ).toBe(true);
    await press("Stop");
    expect(
      await shows(
        () => panel() !== null && inPanel().queryByRole("button", { name: "Run" }) !== null,
      ),
    ).toBe(true);
    expect(runHost?.spawned.at(-1)?.killed).toBe(true);
    expect(inPanel().queryByText("Encerrado")).not.toBeNull();
  });

  test("o log do setup e o estado de espera e de prazo vencido do preview aparecem no painel", async () => {
    const { store, hostId, cardId, key } = await cardScreen(true);
    expect(
      await shows(
        () => panel() !== null && inPanel().queryByRole("button", { name: "Run" }) !== null,
      ),
    ).toBe(true);
    const state = (ready: "waiting" | "timeout") => ({
      cardId,
      status: "running" as const,
      setup: "done" as const,
      setupTerminalId: "term-setup",
      ports: { web: 41000 },
      processes: [
        {
          name: "web",
          terminalId: "term-web",
          status: "running" as const,
          exitCode: null,
          url: "http://127.0.0.1:41000/",
          ready,
        },
      ],
      error: null,
    });
    const show = async (next: ReturnType<typeof state>) => {
      await act(async () => {
        (store as unknown as { update(patch: object): void }).update({
          runEnvs: { [key]: next },
        });
      });
    };
    await show(state("waiting"));
    expect(inPanel().queryByText("esperando web responder…")).not.toBeNull();
    expect(inPanel().queryByRole("button", { name: "Abrir preview de web" })).toBeNull();
    await show(state("timeout"));
    expect(inPanel().queryByText("web não respondeu a tempo")).not.toBeNull();
    await press("Ver log de Setup");
    expect(store.router.current).toEqual({
      name: "terminal",
      host: hostId,
      terminalId: "term-setup",
    });
  });

  test("um setup que falha mostra o código, e o Run está lá para tentar de novo", async () => {
    const { runHost } = await cardScreen(true);
    expect(
      await shows(
        () => panel() !== null && inPanel().queryByRole("button", { name: "Run" }) !== null,
      ),
    ).toBe(true);
    await press("Run");
    expect(
      await shows(() => panel() !== null && inPanel().queryByText("Preparando (setup)…") !== null),
    ).toBe(true);
    runHost?.finish("term-1", 3);
    expect(
      await shows(
        () => panel() !== null && inPanel().queryByText("o setup falhou (código 3)") !== null,
      ),
    ).toBe(true);
    expect(inPanel().queryByText("Falhou")).not.toBeNull();
    expect(inPanel().queryByRole("button", { name: "Run" })).not.toBeNull();
  });

  test("um run.yaml com erros mostra os erros e não oferece Confiar nem Run", async () => {
    const ctx = await setup();
    git(join(ctx.root, "run-app"), "checkout", "-q", "-b", "main-2");
    writeFileSync(
      join(ctx.root, "run-app", ".flightdeck", "run.yaml"),
      'run:\n  - name: a\n    cmd: "x"\n',
    );
    git(join(ctx.root, "run-app"), "commit", "-qam", "run.yaml quebrado");
    git(join(ctx.root, "run-app"), "branch", "-f", "main");
    render(<App store={ctx.store} />);
    await act(async () => {
      ctx.store.router.push({
        name: "card",
        host: ctx.hostId,
        projectId: ctx.projectId,
        cardId: ctx.cardId,
      });
    });
    expect(await shows(() => panel() !== null)).toBe(true);
    expect(
      await shows(
        () => inPanel().queryByText("run.0.cmd: precisa ser uma lista de textos") !== null,
      ),
    ).toBe(true);
    expect(inPanel().queryByRole("button", { name: "Confiar neste run.yaml" })).toBeNull();
    expect(inPanel().queryByRole("button", { name: "Run" })).toBeNull();
  });

  test("sem run.yaml no projeto, o card não mostra o painel", async () => {
    const ctx = await setup();
    git(join(ctx.root, "run-app"), "rm", "-q", ".flightdeck/run.yaml");
    git(join(ctx.root, "run-app"), "commit", "-qm", "sem run.yaml");
    render(<App store={ctx.store} />);
    await act(async () => {
      ctx.store.router.push({
        name: "card",
        host: ctx.hostId,
        projectId: ctx.projectId,
        cardId: ctx.cardId,
      });
    });
    await Bun.sleep(400);
    expect(panel()).toBeNull();
  });
});
