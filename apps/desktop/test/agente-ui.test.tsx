import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

// Real git, real MCP servers and a real daemon: more than the default 5 s.
setDefaultTimeout(30_000);

const ECO = resolve(import.meta.dir, "../../daemon/test/fixtures/mcp/eco-server.ts");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const click = async (name: string | RegExp, role = "button") => {
  const element = screen.queryByRole(role, { name });
  expect(element).not.toBeNull();
  await act(async () => {
    fireEvent.click(element as HTMLElement);
  });
};

const type = async (label: string | RegExp, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};

/** A Radix tab opens on mouse down. */
const openTab = async (name: string) => {
  const tab = screen.queryByRole("tab", { name });
  expect(tab).not.toBeNull();
  await act(async () => {
    fireEvent.mouseDown(tab as HTMLElement, { button: 0 });
  });
};

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

/**
 * A host with a git repository that has an .mcp.json (the eco server, with a secret, and one that
 * leaves a marker file when it starts), a settings.local.json, and a user ~/.claude.json with
 * one server. Opens the Agente screen of the project.
 */
async function setup(options: { agentcfg?: boolean } = {}) {
  const d = makeDaemon(cleanups, { checkpoints: true, agentcfg: options.agentcfg ?? true });
  const repo = join(d.root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  const marker = join(repo, "subiu.txt");
  writeFileSync(
    join(repo, ".mcp.json"),
    JSON.stringify({
      outra: "chave preservada",
      mcpServers: {
        eco: { command: process.execPath, args: [ECO], env: { TOKEN: "segredo" } },
        marcador: {
          command: process.execPath,
          args: ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`],
        },
      },
    }),
  );
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, ".claude", "settings.local.json"), JSON.stringify({ other: 1 }));
  writeFileSync(
    join(d.root, "claude.json"),
    JSON.stringify({
      mcpServers: { global: { command: "python", args: ["srv.py"] } },
      projects: { [repo]: { mcpServers: { local: { command: "python", args: ["loc.py"] } } } },
    }),
  );
  writeFileSync(join(repo, "README.md"), "# repo\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  const server = d.listen();
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id as string;
  await act(async () => {
    await store.hostCommand(hostId, "project.add", { path: repo });
  });
  await sidebar.hostAction("Projetos", "alfa");
  if (options.agentcfg !== false) {
    await settle(() => screen.queryByRole("button", { name: "Agente de repo" }) !== null);
    await click("Agente de repo");
    await settle(() => screen.queryByRole("heading", { name: "Agente de repo" }) !== null);
  }
  return { ...d, repo, marker, store, hostId };
}

describe("agente-ui", () => {
  test("a página do projeto tem as quatro abas e abre no MCP", async () => {
    await setup();
    expect(screen.queryByRole("heading", { name: "Agente de repo" })).not.toBeNull();
    for (const name of ["MCP", "CLAUDE.md", "Agentes", "Skills"]) {
      expect(screen.queryByRole("tab", { name })).not.toBeNull();
    }
    expect(screen.queryByRole("tab", { name: "MCP" })?.getAttribute("aria-selected")).toBe("true");
  });

  test("um daemon sem a config do agente não mostra o botão Agente", async () => {
    await setup({ agentcfg: false });
    await settle(() => screen.queryByRole("button", { name: "Abrir board de repo" }) !== null);
    expect(screen.queryByRole("button", { name: "Abrir board de repo" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Agente de repo" })).toBeNull();
  });

  test("MCP: cada servidor com a origem e o só leitura, e abrir a lista não inicia nenhum", async () => {
    const { marker } = await setup();
    await settle(() => screen.queryByText("eco") !== null);
    expect(screen.queryByText("eco")).not.toBeNull();
    expect(screen.queryByText("global")).not.toBeNull();
    const row = (name: string) => screen.queryByRole("listitem", { name }) as HTMLElement;
    expect(within(row("eco")).queryByText("Do projeto")).not.toBeNull();
    expect(within(row("eco")).queryByText("Só leitura")).toBeNull();
    expect(within(row("global")).queryByText("Do usuário (~/.claude.json)")).not.toBeNull();
    expect(within(row("global")).queryByText("Só leitura")).not.toBeNull();
    expect(within(row("global")).queryByRole("button", { name: "Remover global" })).toBeNull();
    expect(
      within(row("local")).queryByText("Do usuário, neste projeto (~/.claude.json)"),
    ).not.toBeNull();
    expect(within(row("local")).queryByText("Só leitura")).not.toBeNull();
    expect(screen.queryByText(/O \.mcp\.json é versionado/)).not.toBeNull();
    // Nothing runs because the list was opened.
    await act(() => Bun.sleep(300));
    expect(existsSync(marker)).toBe(false);
  });

  test("Testar mostra o comando exato, cancelar não roda nada e confirmar lista ferramentas e recursos", async () => {
    const { marker } = await setup();
    await settle(() => screen.queryByRole("button", { name: "Testar marcador" }) !== null);
    await click("Testar marcador");
    await settle(() => screen.queryByRole("alertdialog") !== null);
    const dialog = screen.queryByRole("alertdialog") as HTMLElement;
    expect(dialog.textContent).toContain(process.execPath);
    expect(dialog.textContent).toContain("subiu.txt");
    await click("Cancelar");
    await act(() => Bun.sleep(300));
    expect(existsSync(marker)).toBe(false);

    await click("Testar eco");
    await settle(() => screen.queryByRole("alertdialog") !== null);
    expect((screen.queryByRole("alertdialog") as HTMLElement).textContent).toContain(ECO);
    await click("Executar e testar");
    await settle(() => screen.queryByText("Ferramentas de eco") !== null, 10_000);
    const tools = screen.queryByText("Ferramentas de eco")?.parentElement as HTMLElement;
    expect(tools.textContent).toContain("eco");
    const resources = screen.queryByText("Recursos de eco")?.parentElement as HTMLElement;
    expect(resources.textContent).toContain("nota");
  });

  test("os segredos aparecem mascarados e salvar exige digitá-los de novo", async () => {
    const { repo } = await setup();
    await settle(() => screen.queryByRole("button", { name: "Editar eco" }) !== null);
    expect(document.body.textContent).not.toContain("segredo");
    await click("Editar eco");
    await settle(() => screen.queryByRole("dialog") !== null);
    expect((screen.queryByLabelText(/^Variáveis de ambiente/) as HTMLTextAreaElement).value).toBe(
      "TOKEN=••••••",
    );
    expect(screen.queryByText(/Digite de novo cada valor mascarado/)).not.toBeNull();
    const save = screen.queryByRole("button", { name: "Salvar no .mcp.json" });
    expect(save?.hasAttribute("disabled")).toBe(true);
    await type(/^Variáveis de ambiente/, "TOKEN=novo");
    expect(save?.hasAttribute("disabled")).toBe(false);
    await click("Salvar no .mcp.json");
    await settle(() => json(join(repo, ".mcp.json")).mcpServers.eco.env.TOKEN === "novo");
    const saved = json(join(repo, ".mcp.json"));
    expect(saved.mcpServers.eco.env.TOKEN).toBe("novo");
    expect(saved.outra).toBe("chave preservada");
    expect(saved.mcpServers.marcador).toBeDefined();
  });

  test("adicionar e remover um servidor escrevem só o .mcp.json, e remover pede confirmação", async () => {
    const { repo } = await setup();
    await settle(() => screen.queryByRole("button", { name: "Adicionar servidor" }) !== null);
    await click("Adicionar servidor");
    await settle(() => screen.queryByRole("dialog") !== null);
    const save = screen.queryByRole("button", { name: "Salvar no .mcp.json" });
    expect(save?.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("Dê um nome ao servidor.")).not.toBeNull();
    await type("Nome do servidor", "novo");
    expect(screen.queryByText("Falta o comando.")).not.toBeNull();
    await type("Comando", "node");
    await type(/^Argumentos/, "a.js\n--porta 1");
    await click("Salvar no .mcp.json");
    await settle(() => json(join(repo, ".mcp.json")).mcpServers.novo !== undefined);
    expect(json(join(repo, ".mcp.json")).mcpServers.novo).toEqual({
      command: "node",
      args: ["a.js", "--porta 1"],
    });
    await settle(() => screen.queryByRole("button", { name: "Remover novo" }) !== null);

    await click("Remover novo");
    await settle(() => screen.queryByRole("alertdialog") !== null);
    expect(json(join(repo, ".mcp.json")).mcpServers.novo).toBeDefined();
    await click("Remover servidor");
    await settle(() => json(join(repo, ".mcp.json")).mcpServers.novo === undefined);
    expect(json(join(repo, ".mcp.json")).mcpServers.novo).toBeUndefined();
    expect(json(join(repo, ".mcp.json")).mcpServers.eco).toBeDefined();
  });

  test("um servidor por URL pede a URL e salva com o transporte", async () => {
    const { repo } = await setup();
    await settle(() => screen.queryByRole("button", { name: "Adicionar servidor" }) !== null);
    await click("Adicionar servidor");
    await settle(() => screen.queryByRole("dialog") !== null);
    await type("Nome do servidor", "remoto");
    await type("Transporte", "http");
    expect(screen.queryByText("Falta a URL.")).not.toBeNull();
    expect(screen.queryByLabelText("Comando")).toBeNull();
    await type("URL", "https://mcp.example.com");
    await type(/^Cabeçalhos/, "Authorization: Bearer abc");
    await click("Salvar no .mcp.json");
    await settle(() => json(join(repo, ".mcp.json")).mcpServers.remoto !== undefined);
    expect(json(join(repo, ".mcp.json")).mcpServers.remoto).toEqual({
      type: "http",
      url: "https://mcp.example.com",
      headers: { Authorization: "Bearer abc" },
    });
  });

  test("ligar e desligar grava o settings.local.json; o servidor do usuário não liga", async () => {
    const { repo } = await setup();
    await settle(() => screen.queryByRole("switch", { name: "Ligar eco" }) !== null);
    const eco = screen.queryByRole("switch", { name: "Ligar eco" }) as HTMLElement;
    expect(eco.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("switch", { name: "Ligar global" })?.hasAttribute("disabled")).toBe(
      true,
    );
    await act(async () => {
      fireEvent.click(eco);
    });
    const settings = join(repo, ".claude", "settings.local.json");
    await settle(() => (json(settings).disabledMcpjsonServers ?? []).includes("eco"));
    expect(json(settings).disabledMcpjsonServers).toEqual(["eco"]);
    expect(json(settings).other).toBe(1);
    await settle(
      () =>
        screen.queryByRole("switch", { name: "Ligar eco" })?.getAttribute("aria-checked") ===
        "false",
    );
    expect(screen.queryByRole("switch", { name: "Ligar eco" })?.getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  test("uma configuração que não carrega mostra o erro e tenta de novo", async () => {
    const { store, hostId } = await setup();
    await act(async () => {
      store.router.push({ name: "agent", host: hostId, projectId: "nenhum", projectName: "x" });
    });
    await settle(() => screen.queryByRole("alert") !== null);
    expect(
      screen.queryByText("Não foi possível carregar a configuração deste projeto."),
    ).not.toBeNull();
    await click("Tentar de novo");
    await settle(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByRole("alert")).not.toBeNull();
  });
});
