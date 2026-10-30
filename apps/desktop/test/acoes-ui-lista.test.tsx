import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";
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

async function settle(check: () => boolean, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const click = async (name: string | RegExp, scope: HTMLElement | null = null) => {
  const button = (scope ? within(scope) : screen).queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const DEPLOY = {
  name: "deploy-staging",
  description: "Faz o deploy da branch na VPS de staging",
  run: ["./scripts/deploy.sh", "{{param.branch}}"],
  env: { DEPLOY_TOKEN: "{{secret.deploy-token}}" },
  params: { branch: { pattern: "^[a-zA-Z0-9._/-]{1,80}$", default: "main" } },
  timeoutS: 600,
};
const LOGS = {
  name: "logs-prod",
  description: "Últimas linhas do log da API em produção",
  ssh: "prod-api",
  run: ["journalctl", "-u", "api", "--no-pager"],
};

/** A host with a project and two actions made in the app, on the projects screen. */
async function online(features?: string[]) {
  const d = await workflowDaemon(cleanups, {}, [], { actions: true });
  const actions = d.actions;
  if (!actions) throw new Error("o daemon de teste não tem as ações");
  await actions.save({
    projectId: d.project.id,
    definition: DEPLOY,
    secretIds: ["deploy-token"],
  });
  await actions.save({ projectId: d.project.id, definition: LOGS });
  const server = features ? d.listen(0, undefined, features) : d.server;
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  await sidebar.hostAction("Projetos", "alfa");
  await settle(() => screen.queryByRole("button", { name: "Workflows de repo" }) !== null);
  return { ...d, actions, store };
}
const open = async () => {
  await click("Ações de repo");
  await settle(() => screen.queryByRole("list", { name: "Ações" }) !== null);
};
const row = (name: string) => screen.queryByRole("listitem", { name: `Ação ${name}` });

describe("acoes-ui-lista: as ações de um projeto", () => {
  test("um daemon que não anuncia actions não tem o botão", async () => {
    await online(["workflows", "rules"]);
    expect(screen.queryByRole("button", { name: "Ações de repo" })).toBeNull();
  });

  test("a lista mostra cada ação com a descrição, onde roda, a aprovação, os segredos e os parâmetros", async () => {
    await online();
    await open();
    await settle(() => row("deploy-staging") !== null);
    const deploy = row("deploy-staging") as HTMLElement;
    for (const part of [
      "Faz o deploy da branch na VPS de staging",
      "Neste host",
      "Pede na primeira vez da sessão",
      "Segredos: deploy-token",
      "Parâmetros: branch",
      "Criada no app",
    ]) {
      expect(deploy.textContent).toContain(part);
    }
    const logs = row("logs-prod") as HTMLElement;
    expect(logs.textContent).toContain("SSH prod-api");
    expect(logs.textContent).toContain("Nunca pede aprovação");
    expect(logs.textContent).not.toContain("Segredos:");
  });

  test("sem ações, a tela diz que o projeto não tem nenhuma", async () => {
    const d = await online();
    await act(async () => {
      await d.actions.remove(d.project.id, "deploy-staging");
      await d.actions.remove(d.project.id, "logs-prod");
    });
    await open();
    await settle(() => screen.queryByText("Nenhuma ação neste projeto") !== null);
    expect(screen.queryByText("Nenhuma ação neste projeto")).not.toBeNull();
  });

  test("uma ação do arquivo versionado aparece como versionada, e o erro de outra é mostrado", async () => {
    const d = await online();
    mkdirSync(join(d.repo, ".flightdeck"), { recursive: true });
    writeFileSync(
      join(d.repo, ".flightdeck/actions.yaml"),
      [
        "- name: testes",
        "  description: Roda os testes",
        '  run: ["bun", "test"]',
        "- name: quebrada",
        "  description: sem run",
        "",
      ].join("\n"),
    );
    git(d.repo, "add", ".flightdeck/actions.yaml");
    git(d.repo, "commit", "-q", "-m", "ações");
    await open();
    await settle(() => row("testes") !== null);
    expect((row("testes") as HTMLElement).textContent).toContain("Versionada");
    const problems = screen.queryByRole("list", { name: "Problemas no arquivo de ações" });
    expect(problems?.textContent).toContain("quebrada");
  });

  test("a tela diz o limite: o segredo fica longe do Claude, não de outro processo do mesmo usuário", async () => {
    await online();
    await open();
    const notice = screen.queryByRole("note");
    expect(notice?.textContent).toContain("mesmo usuário");
    expect(notice?.textContent).toContain("ssh");
  });
});
