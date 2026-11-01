import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";
import { waiter } from "./wait.ts";
import { workflowDaemon } from "./workflow-fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

// Real git under the in-process daemon: more than the default 5 s.
setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(6000);

const click = async (name: string | RegExp, scope: HTMLElement | null = null) => {
  const button = (scope ? within(scope) : screen).queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const change = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};

const row = (name: string) => screen.queryByRole("listitem", { name: `Ação ${name}` });
const dialog = () => screen.queryByRole("dialog") as HTMLElement | null;

/** A host with one secret in the app's vault and one versioned action, on the Ações screen. */
async function online() {
  const d = await workflowDaemon(cleanups, {}, [], { actions: true });
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "alfa", url: d.server.url, token: TOKEN }));
  const secret = await store.addSecret({
    name: "token-staging",
    type: "token",
    value: "form-value-xyz",
    allowedHosts: [hostId],
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  await sidebar.hostAction("Projetos", "alfa");
  await settle(() => screen.queryByRole("button", { name: "Ações de repo" }) !== null);
  await click("Ações de repo");
  await settle(() => screen.queryByRole("button", { name: "Nova ação" }) !== null);
  return { ...d, store, secret };
}
const listed = (d: Awaited<ReturnType<typeof online>>) => d.actions?.list(d.project.id);

/** Fills the form with a valid action that uses the vault secret. */
async function fill(secretId: string, name = "deploy") {
  await change("Nome da ação", name);
  await change("Descrição", "Faz o deploy");
  await change("Comando, um argumento por linha", "./deploy.sh\n{{param.branch}}");
  await click("Adicionar variável");
  await change("Nome da variável 1", "DEPLOY_TOKEN");
  await change("Segredo da variável 1", secretId);
  await click("Adicionar parâmetro");
  await change("Nome do parâmetro 1", "branch");
  await change("Padrão do parâmetro 1", "^[a-z]{1,20}$");
  await change("Valor inicial do parâmetro 1", "main");
}

describe("acoes-ui-form: criar, editar e remover uma ação do app", () => {
  test("Nova ação cria a ação com o segredo escolhido no seletor e ela aparece na lista", async () => {
    const d = await online();
    await click("Nova ação");
    // The picker offers the vault's secrets by name, never a value.
    const picker = screen.queryByLabelText("Segredo da variável 1");
    expect(picker).toBeNull();
    await click("Adicionar variável");
    expect((screen.queryByLabelText("Segredo da variável 1") as HTMLElement).textContent).toContain(
      "token-staging",
    );
    expect(dialog()?.textContent).not.toContain("form-value-xyz");
    await fill(d.secret.id);
    await click("Salvar", dialog());
    await settle(() => row("deploy") !== null);
    const saved = (await listed(d))?.actions.find((a) => a.name === "deploy");
    expect(saved?.run).toEqual(["./deploy.sh", "{{param.branch}}"]);
    expect(saved?.env).toEqual({ DEPLOY_TOKEN: `{{secret.${d.secret.id}}}` });
    expect(saved?.params).toEqual({ branch: { pattern: "^[a-z]{1,20}$", default: "main" } });
    expect(saved?.source).toBe("app");
    expect(dialog()).toBeNull();
  });

  test("o que o daemon recusa aparece no formulário, que continua aberto", async () => {
    const d = await online();
    await click("Nova ação");
    await fill(d.secret.id);
    await change("Padrão do parâmetro 1", "[");
    await click("Salvar", dialog());
    await settle(() => within(dialog() as HTMLElement).queryByRole("alert") !== null);
    expect(within(dialog() as HTMLElement).queryByRole("alert")?.textContent).toContain(
      "A ação tem problemas",
    );
    expect(dialog()?.textContent).toContain("não é uma regex válida");
    expect((await listed(d))?.actions).toEqual([]);
  });

  test("Editar abre a ação já preenchida, com o nome travado, e salva a mudança", async () => {
    const d = await online();
    await d.actions?.save({
      projectId: d.project.id,
      definition: { name: "eco", description: "ecoa", run: ["echo", "oi"] },
    });
    await sidebar.hostAction("Projetos", "alfa");
    await settle(() => screen.queryByRole("button", { name: "Ações de repo" }) !== null);
    await click("Ações de repo");
    await settle(() => row("eco") !== null);
    await click("Editar eco", row("eco"));
    expect((screen.queryByLabelText("Nome da ação") as HTMLInputElement).value).toBe("eco");
    expect((screen.queryByLabelText("Nome da ação") as HTMLInputElement).disabled).toBe(true);
    expect(
      (screen.queryByLabelText("Comando, um argumento por linha") as HTMLInputElement).value,
    ).toBe("echo\noi");
    await change("Descrição", "ecoa duas vezes");
    await click("Salvar", dialog());
    await settle(() => row("eco")?.textContent?.includes("ecoa duas vezes") === true);
    expect((await listed(d))?.actions.find((a) => a.name === "eco")?.description).toBe(
      "ecoa duas vezes",
    );
  });

  test("Remover pede confirmação, e cancelar não remove nada", async () => {
    const d = await online();
    await d.actions?.save({
      projectId: d.project.id,
      definition: { name: "eco", description: "ecoa", run: ["echo", "oi"] },
    });
    await sidebar.hostAction("Projetos", "alfa");
    await settle(() => screen.queryByRole("button", { name: "Ações de repo" }) !== null);
    await click("Ações de repo");
    await settle(() => row("eco") !== null);
    await click("Remover eco", row("eco"));
    await click("Cancelar", screen.queryByRole("alertdialog"));
    expect((await listed(d))?.actions).toHaveLength(1);
    await click("Remover eco", row("eco"));
    await click("Remover", screen.queryByRole("alertdialog"));
    await settle(() => row("eco") === null);
    expect((await listed(d))?.actions).toEqual([]);
  });

  test("Cancelar e Escape fecham o formulário sem criar nada", async () => {
    const d = await online();
    await click("Nova ação");
    await change("Nome da ação", "descartada");
    await click("Cancelar", dialog());
    expect(dialog()).toBeNull();
    // Escape closes it too.
    await click("Nova ação");
    await act(async () => {
      fireEvent.keyDown(dialog() as HTMLElement, { key: "Escape" });
    });
    await settle(() => dialog() === null);
    expect(dialog()).toBeNull();
    expect((await listed(d))?.actions).toEqual([]);
  });

  test("editar uma ação com segredo, valor fixo e parâmetro: os campos vêm preenchidos, remover linhas tira só elas e o valor fixo fica", async () => {
    const d = await online();
    await d.actions?.save({
      projectId: d.project.id,
      definition: {
        name: "logs",
        description: "lê o log",
        run: ["journalctl", "-n", "{{param.lines}}"],
        ssh: "prod-api",
        env: { TOKEN: `{{secret.${d.secret.id}}}`, LANG: "C" },
        params: { lines: { pattern: "^[0-9]{1,4}$", default: "200" } },
        approval: "always",
      },
      secretIds: [d.secret.id],
    });
    await sidebar.hostAction("Projetos", "alfa");
    await settle(() => screen.queryByRole("button", { name: "Ações de repo" }) !== null);
    await click("Ações de repo");
    await settle(() => row("logs") !== null);
    await click("Editar logs", row("logs"));
    const value = (label: string) => (screen.queryByLabelText(label) as HTMLInputElement).value;
    expect(value("Nome da variável 1")).toBe("TOKEN");
    expect(value("Segredo da variável 1")).toBe(d.secret.id);
    expect(value("Nome do parâmetro 1")).toBe("lines");
    expect(value("Valor inicial do parâmetro 1")).toBe("200");
    expect(value("Destino SSH (vazio: roda neste host)")).toBe("prod-api");
    expect(value("Aprovação")).toBe("always");
    await change("Pasta (opcional)", "/srv/app");
    await change("Tempo limite em segundos (opcional)", "30");
    await change("Aprovação", "never");
    await change("Destino SSH (vazio: roda neste host)", "prod-api-2");
    await click("Remover variável 1");
    await click("Remover parâmetro 1");
    await change("Comando, um argumento por linha", "journalctl\n-n\n50");
    await click("Salvar", dialog());
    await settle(() => dialog() === null);
    const saved = (await listed(d))?.actions.find((a) => a.name === "logs");
    expect(saved?.env).toEqual({ LANG: "C" });
    expect(saved?.params).toEqual({});
    expect(saved?.ssh).toBe("prod-api-2");
    expect(saved?.cwd).toBe("/srv/app");
    expect(saved?.timeoutS).toBe(30);
    expect(saved?.approval).toBe("never");
  });

  test("a route with a draft opens Nova ação already filled with its name and command (phase 18 hands over a snippet)", async () => {
    const d = await online();
    await act(async () => {
      d.store.router.push({
        name: "actions",
        host: d.store.getState().hosts[0]?.id ?? "",
        projectId: d.project.id,
        projectName: "repo",
        draft: { name: "limpar", run: ["rm", "-rf", "build"] },
      });
    });
    await settle(() => dialog() !== null);
    const name = screen.queryByLabelText("Nome da ação") as HTMLInputElement;
    expect(name.value).toBe("limpar");
    expect(name.disabled).toBe(false);
    expect(
      (screen.queryByLabelText("Comando, um argumento por linha") as HTMLInputElement).value,
    ).toBe("rm\n-rf\nbuild");
  });
});
