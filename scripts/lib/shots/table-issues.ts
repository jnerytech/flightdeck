/** Part of the print table (scripts/demo-shots.ts), in print order: the Issues panel and the missing-tool cards (#4099). */

import type { DepsResult, Issue } from "@flightdeck/protocol";
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { ALFA, type Shot } from "./shot.ts";

/** The board's Issues button opens the panel, and the print waits for what the panel shows first. */
async function panelOpen(page: Page, ready: RegExp): Promise<void> {
  await page.getByRole("button", { name: /^(Issues)$/ }).click({ timeout: 15_000 });
  await page.getByRole("dialog").getByText(ready).first().waitFor({ timeout: 15_000 });
}

/** The demo's list: the three issues the fake gh lists, one with a card and one by an outside author. */
const listed = (page: Page) => panelOpen(page, /^(Limitar a taxa da exportação)$/);

/** One issue as `issues.list` answers it, for the prints that need a list of their own (#4259). */
function issue(n: number, title: string, labels: string[] = ["backend"]): Issue {
  return {
    ref: `github:Acme/App#${n}`,
    id: String(n),
    title,
    body: "",
    url: `https://github.com/Acme/App/issues/${n}`,
    author: "ana",
    labels,
    external: false,
    createdAt: "2026-10-01T10:00:00Z",
  };
}

/** Twelve issues, three of them about the login: the filter print keeps those three. */
const TWELVE: Issue[] = [
  "Corrigir o login com SSO",
  "Limitar a taxa da exportação",
  "Mostrar o login por SAML",
  "Reduzir o tempo de build",
  "Traduzir as mensagens de erro",
  "Salvar o login entre as abas",
  "Cachear a lista de projetos",
  "Registrar as falhas do agente",
  "Ordenar os cards por prioridade",
  "Avisar quando o disco encher",
  "Exportar o histórico em CSV",
  "Revisar as permissões do vault",
].map((title, i) => issue(i + 1, title));

/** A full page of the cap the host reads (50), marked cut: the panel says so (#4255). */
const FIFTY: Issue[] = Array.from({ length: 50 }, (_, i) => issue(i + 1, `Issue número ${i + 1}`));

/** A title with no space to break at: the row must wrap it inside the sheet (#4258). */
const LONG_TITLE = `Falha_ao_exportar_${"relatorio_trimestral_de_desempenho_".repeat(3)}final`;

const filterBox = (page: Page) =>
  page.getByRole("textbox", { name: /^(Filter issues|Filtrar issues)$/ });

/**
 * What `deps.check` answers on every host in the tool-card prints: `git` (required) and the GitHub CLI
 * (optional) are missing, with an install page each. The demo's hosts have both, so the answer is faked.
 */
const MISSING_TOOLS: DepsResult = {
  items: [
    {
      id: "git",
      group: "required",
      state: "missing",
      breaks: ["projects", "worktrees"],
      fix: [{ os: "linux", url: "https://git-scm.com/downloads" }],
    },
    {
      id: "gh",
      group: "optional",
      state: "missing",
      breaks: ["github", "pullRequests"],
      fix: [{ os: "linux", url: "https://cli.github.com" }],
    },
  ],
};

/**
 * The start screen shows its cards from what a host page read earlier (only that page asks the host),
 * and the window shows it only with no tab at all, so the print opens a host page and then sends the
 * demo's `flightdeck:demo-start` event, which opens the start screen in a shared tab (the host's tab stays).
 */
async function startScreen(page: Page): Promise<void> {
  await page.getByRole("tab").first().waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new Event("flightdeck:demo-start")));
  const note = page
    .getByRole("note")
    .filter({ hasText: /GitHub CLI|Git\b/ })
    .first();
  try {
    await note.waitFor({ timeout: 15_000 });
  } catch (error) {
    // A print that cannot show its card says what the page held instead.
    const tabs = await page.getByRole("tab").allTextContents();
    const held =
      (await page
        .locator("main")
        .first()
        .textContent({ timeout: 1000 })
        .catch(() => "")) ?? "";
    throw new Error(`no tool note; tabs: ${tabs.join(" | ")}; main holds: ${held.slice(0, 600)}`, {
      cause: error,
    });
  }
}

export function issuesShots(ids: DemoIds): Shot[] {
  const board = { name: "board" as const, host: ALFA, projectId: ids.project };
  const tools = { name: "host" as const, host: ALFA };
  const wire = [{ command: "deps.check", data: MISSING_TOOLS }];
  return [
    { name: "issues-lista", route: board, prepare: listed },
    {
      name: "issues-vazia",
      route: board,
      wire: [{ command: "issues.list", data: { issues: [] } }],
      prepare: (page) => panelOpen(page, /^(No issues found|Nenhuma issue encontrada)$/),
    },
    {
      name: "issues-falha",
      route: board,
      wire: [{ command: "issues.list", refuse: "gh could not read the issues." }],
      prepare: (page) =>
        panelOpen(page, /(Could not list the issues|Não consegui listar as issues)/),
    },
    {
      name: "issues-conectar",
      route: { ...board, projectId: ids.emptyProject },
      prepare: (page) =>
        panelOpen(
          page,
          /^(Connect GitHub or Azure Boards issues|Conecte as issues do GitHub ou do Azure Boards)$/,
        ),
    },
    {
      name: "issues-configurar",
      route: board,
      async prepare(page) {
        await listed(page);
        await page.getByRole("button", { name: /^(Configure issues|Configurar issues)$/ }).click();
        await page
          .getByRole("combobox", { name: /^(Issues provider|Provedor de issues)$/ })
          .waitFor();
      },
    },
    {
      name: "issues-configurar-azure",
      route: board,
      async prepare(page) {
        await listed(page);
        await page.getByRole("button", { name: /^(Configure issues|Configurar issues)$/ }).click();
        await page
          .getByRole("combobox", { name: /^(Issues provider|Provedor de issues)$/ })
          .selectOption("azure");
        await page.getByText(/WIQL/).first().waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "issues-contagem",
      route: board,
      wire: [{ command: "issues.list", data: { issues: TWELVE } }],
      prepare: (page) => panelOpen(page, /^12 issues$/),
    },
    {
      name: "issues-contagem-filtro",
      route: board,
      wire: [{ command: "issues.list", data: { issues: TWELVE } }],
      async prepare(page) {
        await panelOpen(page, /^12 issues$/);
        await filterBox(page).fill("login");
        await page
          .getByRole("dialog")
          .getByText(/^(3 of 12 issues|3 de 12 issues)$/)
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "issues-filtro-vazio",
      route: board,
      wire: [{ command: "issues.list", data: { issues: TWELVE } }],
      async prepare(page) {
        await panelOpen(page, /^12 issues$/);
        await filterBox(page).fill("zzz");
        await page
          .getByRole("button", { name: /^(Clear filter|Limpar filtro)$/ })
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "issues-cortada",
      route: board,
      wire: [{ command: "issues.list", data: { issues: FIFTY, truncated: true } }],
      prepare: (page) =>
        panelOpen(page, /(Showing the first 50 issues|Mostrando as primeiras 50 issues)/),
    },
    {
      name: "issues-titulo-longo",
      route: board,
      wire: [{ command: "issues.list", data: { issues: [issue(1, LONG_TITLE)] } }],
      prepare: (page) => panelOpen(page, new RegExp(`^${LONG_TITLE}$`)),
    },
    { name: "ferramentas-cartoes", route: tools, wire, prepare: startScreen },
    {
      name: "ferramentas-dispensada",
      route: tools,
      wire,
      async prepare(page) {
        await startScreen(page);
        await page
          .getByRole("button", {
            name: /^(Dismiss the note about GitHub CLI|Dispensar o aviso sobre GitHub CLI)/,
          })
          .first()
          .click();
        await page
          .getByRole("button", { name: /^(Undo|Desfazer)/ })
          .first()
          .waitFor({ timeout: 8000 });
      },
    },
  ];
}
