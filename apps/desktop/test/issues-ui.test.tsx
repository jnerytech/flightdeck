import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Issue } from "@flightdeck/protocol";
import { filterIssues, issueLabel, issueNumber, issueUrl } from "../src/lib/issues.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { ghIssue, ghRules, issuesDaemon } from "./issues-fixtures.ts";
import { sidebarNav } from "./sidebar.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

// Real git, a fake `gh` (a Bun process per call) and the in-process daemon: more than 5 s.
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

const click = async (name: string | RegExp, within_: HTMLElement | null = null) => {
  const scope = within_ ? within(within_) : screen;
  const button = scope.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const type = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};

const issue = (over: Partial<Issue> = {}): Issue => ({
  ref: "github:Acme/App#2",
  id: "2",
  title: "Corrigir login",
  body: "corpo",
  url: "https://github.com/Acme/App/issues/2",
  author: "ana",
  labels: ["bug", "auto"],
  external: false,
  createdAt: "2026-10-01T10:00:00Z",
  ...over,
});

describe("issues-ui: o que se sabe de uma issue", () => {
  test("o endereço vem do ref: GitHub e Azure Boards; um ref que não é de nenhum dos dois não tem", () => {
    expect(issueUrl("github:Acme/App#12")).toBe("https://github.com/Acme/App/issues/12");
    expect(issueUrl("azure:acme/Projeto X#345")).toBe(
      "https://dev.azure.com/acme/Projeto%20X/_workitems/edit/345",
    );
    expect(issueUrl("jira:ACME-1")).toBeNull();
    expect(issueUrl("github:sem-numero")).toBeNull();
  });

  test("o rótulo é o ref sem o provedor, e o número é só o #", () => {
    expect(issueLabel("github:Acme/App#12")).toBe("Acme/App#12");
    expect(issueNumber("azure:acme/projeto#345")).toBe("#345");
    expect(issueNumber("estranho")).toBe("estranho");
  });

  test("o filtro olha título, ref, autor e rótulos, sem distinguir maiúsculas; em branco devolve tudo", () => {
    const a = issue();
    const b = issue({
      ref: "github:Acme/App#9",
      id: "9",
      title: "Tela de cobrança",
      author: "Zé",
      labels: ["billing"],
    });
    expect(filterIssues([a, b], "")).toEqual([a, b]);
    expect(filterIssues([a, b], "   ")).toEqual([a, b]);
    expect(filterIssues([a, b], "LOGIN")).toEqual([a]);
    expect(filterIssues([a, b], "billing")).toEqual([b]);
    expect(filterIssues([a, b], "zé")).toEqual([b]);
    expect(filterIssues([a, b], "#9")).toEqual([b]);
    expect(filterIssues([a, b], "nada")).toEqual([]);
  });
});

const ISSUES = [
  ghIssue(1),
  ghIssue(2, {
    title: "Tela de cobrança",
    author: { login: "estranho" },
    authorAssociation: "NONE",
    labels: [{ name: "billing" }],
  }),
];

/** The host online with a project whose issues come from the fake `gh`, on its board. */
async function openBoard(options: { config?: "github" | null; features?: string[] } = {}) {
  const config = options.config === null ? null : { provider: "github" as const };
  const d = await issuesDaemon(cleanups, ISSUES, config, options.features);
  const mem = memoryPlatform();
  const opened: string[] = [];
  mem.win.open = (url) => {
    opened.push(String(url));
    return null;
  };
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  await sidebar.hostAction("Projetos", "alfa");
  await settle(() => screen.queryByRole("button", { name: "Abrir board de repo" }) !== null);
  await click("Abrir board de repo");
  await settle(() => screen.queryByRole("heading", { name: "Board de repo" }) !== null);
  return { ...d, store, opened };
}

const panel = () => screen.getByRole("dialog", { name: "Issues" });
const issueRow = (n: number) =>
  within(panel()).queryByRole("listitem", { name: new RegExp(`^Issue #${n}:`) });
const rows = () => within(panel()).queryAllByRole("listitem").length;
async function openPanel() {
  await click("Issues");
  await settle(() => rows() > 0 || screen.queryByRole("dialog", { name: "Issues" }) !== null);
}

describe("issues-ui: o painel no board", () => {
  test("o botão Issues abre o painel com as issues do projeto: título, número, rótulos e autor", async () => {
    await openBoard();
    await openPanel();
    await settle(() => rows() === 2);
    const first = issueRow(1) as HTMLElement;
    expect(within(first).getByText("Issue 1")).toBeTruthy();
    expect(within(first).getByText("#1")).toBeTruthy();
    expect(within(first).getByText("bug")).toBeTruthy();
    expect(within(first).getByText("auto")).toBeTruthy();
    expect(within(first).getByText("ana")).toBeTruthy();
    expect(within(first).queryByText("Autor externo")).toBeNull();
  });

  test("a issue de um autor de fora vem marcada como autor externo", async () => {
    await openBoard();
    await openPanel();
    await settle(() => rows() === 2);
    const stranger = issueRow(2) as HTMLElement;
    expect(within(stranger).getByText("Autor externo")).toBeTruthy();
    expect(within(stranger).getByText("estranho")).toBeTruthy();
  });

  test("o filtro mostra só as issues que combinam, e diz quando nenhuma combina", async () => {
    await openBoard();
    await openPanel();
    await settle(() => rows() === 2);
    await type("Filtrar issues", "cobrança");
    expect(rows()).toBe(1);
    expect(issueRow(2)).not.toBeNull();
    await type("Filtrar issues", "bug");
    expect(issueRow(1)).not.toBeNull();
    await type("Filtrar issues", "zzz");
    expect(rows()).toBe(0);
    expect(within(panel()).getByText("Nenhuma issue encontrada")).toBeTruthy();
  });

  test("Criar card faz o card no Backlog com o link da issue, e a linha passa a oferecer Abrir card", async () => {
    await openBoard();
    await openPanel();
    await settle(() => rows() === 2);
    await click("Criar card", issueRow(1));
    await settle(() => !!within(panel()).queryByText("Card criado"));
    const row = issueRow(1) as HTMLElement;
    expect(within(row).getByText("Card criado")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Criar card" })).toBeNull();
    // The other issue still offers it.
    expect(
      within(issueRow(2) as HTMLElement).getByRole("button", { name: "Criar card" }),
    ).toBeTruthy();
    await click("Fechar", panel());
    await settle(() => screen.queryByLabelText("Card Issue 1") !== null);
    const tile = screen.getByLabelText("Card Issue 1");
    expect(within(tile).getByText("#1")).toBeTruthy();
    expect(within(tile).queryByText("Autor externo")).toBeNull();
  });

  test("o card da issue de um autor de fora leva o selo no board e na tela do card, com o link", async () => {
    const { opened } = await openBoard();
    await openPanel();
    await settle(() => rows() === 2);
    await click("Criar card", issueRow(2));
    await settle(() => !!within(panel()).queryByText("Card criado"));
    await click("Fechar", panel());
    await settle(() => screen.queryByLabelText("Card Tela de cobrança") !== null);
    const tile = screen.getByLabelText("Card Tela de cobrança");
    expect(within(tile).getByText("Autor externo")).toBeTruthy();
    await click("Tela de cobrança", tile);
    await settle(() => screen.queryByRole("button", { name: "Abrir issue Acme/App#2" }) !== null);
    expect(screen.getByText("Autor externo")).toBeTruthy();
    await click("Abrir issue Acme/App#2");
    expect(opened).toEqual(["https://github.com/Acme/App/issues/2"]);
  });

  test("a issue que já tem card oferece Abrir card, e abre a tela dele", async () => {
    await openBoard();
    await openPanel();
    await settle(() => rows() === 2);
    await click("Criar card", issueRow(1));
    await settle(() => !!within(panel()).queryByText("Card criado"));
    await click("Abrir card", issueRow(1));
    await settle(() => screen.queryByRole("button", { name: "Abrir issue Acme/App#1" }) !== null);
    expect(screen.getByRole("button", { name: "Abrir issue Acme/App#1" })).toBeTruthy();
  });

  test("um erro do gh vira estado de erro com Tentar de novo, e tentar de novo lista", async () => {
    const { gh } = await openBoard();
    gh.respond([{ args: ["issue", "list"], code: 1, stdout: "" }, ...ghRules([])]);
    await openPanel();
    await settle(() => !!within(panel()).queryByRole("button", { name: "Tentar de novo" }));
    gh.respond(ghRules(ISSUES));
    await click("Tentar de novo", panel());
    await settle(() => rows() === 2);
    expect(rows()).toBe(2);
  });
});

describe("issues-ui: a conexão com o provedor", () => {
  test("sem integração o painel pede o provedor; salvar conecta e lista as issues", async () => {
    await openBoard({ config: null });
    await click("Issues");
    expect(
      within(panel()).getByText("Conecte as issues do GitHub ou do Azure Boards"),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.change(within(panel()).getByLabelText("Provedor de issues"), {
        target: { value: "github" },
      });
    });
    await click("Conectar issues", panel());
    await settle(() => rows() === 2);
    expect(rows()).toBe(2);
  });

  test("Configurar issues muda a busca e o comentário no PR, que vem desligado", async () => {
    const { project, board } = await openBoard();
    await openPanel();
    await settle(() => rows() === 2);
    await click("Configurar issues", panel());
    const comment = within(panel()).getByRole("switch", {
      name: "Comentar na issue ao abrir o PR",
    });
    expect(comment.getAttribute("aria-checked")).toBe("false");
    await type("Busca de issues", "label:auto is:open");
    await click("Salvar", panel());
    await settle(() => board.getProject(project.id).issues?.query === "label:auto is:open");
    expect(board.getProject(project.id).issues).toEqual({
      provider: "github",
      query: "label:auto is:open",
      commentOnPr: false,
    });
  });

  test("um daemon sem issues, de antes da Fase 13, não mostra o botão", async () => {
    await openBoard({ features: ["workflows"] });
    expect(screen.queryByRole("button", { name: "Issues" })).toBeNull();
  });
});
