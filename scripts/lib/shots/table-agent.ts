/** Part of the print table (scripts/demo-shots.ts), in print order. */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import {
  ALFA,
  agentRoute,
  openHostSettings,
  openTimeline,
  type Shot,
  showSection,
} from "./shot.ts";

/** The session id the forked print shows: the demo's host never writes the fork it stands for. */
const FORKED_SESSION = "7b1f3c52-9d3e-4a6b-8f10-2c5d9e4a1b77";

/** The Fork dialog of turn 2 with "Also rewind the files" ticked. */
async function openForkWithFiles(page: Page): Promise<void> {
  await openTimeline(page);
  await page
    .getByRole("button", { name: /^(Bifurcar daqui|Fork from here) \((turno|turn) 2\)$/ })
    .click();
  await page
    .getByRole("checkbox", { name: /^(Voltar os arquivos também|Also rewind the files)$/ })
    .check();
}

export function agentShots(ids: DemoIds): Shot[] {
  return [
    { name: "host", route: { name: "host", host: ALFA } },
    {
      // Phase 14: two tabs, the second on alfa's page, and the window split in two areas.
      name: "abas-divididas",
      route: { name: "hub" },
      prepare: async (page) => {
        // In the sidebar only: the host page and the project headers have buttons of the same name.
        await page
          .locator("aside")
          .first()
          .getByRole("button", { name: /^(Abrir host alfa|Open host alfa)$/ })
          .click({ modifiers: ["Control"] });
        await page.getByRole("button", { name: /^(Dividir a tela|Split the screen)$/ }).click();
        await page.waitForTimeout(800);
      },
    },
    {
      // Phase 14: an embedded terminal on alfa, live, after an echo.
      name: "terminal",
      route: { name: "host", host: ALFA },
      prepare: async (page) => {
        await openHostSettings(page);
        await page.getByRole("button", { name: /^(Novo terminal|New terminal)$/ }).click();
        await page.getByText(/^(Ao vivo|Live)$/).waitFor({ timeout: 15_000 });
        await page.locator(".xterm").first().click();
        await page.keyboard.type("echo flightdeck\n");
        await page.waitForTimeout(1000);
      },
    },
    // The Agente screen of a project: its four tabs, with a file of each open.
    { name: "agente-mcp", route: agentRoute(ids) },
    {
      name: "agente-claude-md",
      route: agentRoute(ids),
      prepare: async (page) => {
        await page.getByRole("tab", { name: "CLAUDE.md" }).click();
        await page
          .getByRole("button", { name: /^CLAUDE\.md \(/ })
          .first()
          .click();
        await page.waitForTimeout(600);
      },
    },
    {
      name: "agente-agentes",
      route: agentRoute(ids),
      prepare: async (page) => {
        await page.getByRole("tab", { name: /^(Agentes|Agents)$/ }).click();
        await page.getByRole("button", { name: /^revisor \(/ }).click();
        await page.waitForTimeout(600);
      },
    },
    {
      name: "agente-skills",
      route: agentRoute(ids),
      prepare: async (page) => {
        await page.getByRole("tab", { name: "Skills" }).click();
        await page.getByRole("button", { name: /^deploy \(/ }).click();
        await page.waitForTimeout(600);
      },
    },
    // Phase 26: the Memória and Contexto tabs of the Agente screen, and the Plugins page.
    {
      name: "agente-memoria",
      route: agentRoute(ids),
      prepare: async (page) => {
        await page.getByRole("tab", { name: /^(Memória|Memory)$/ }).click();
        await page.getByRole("button", { name: /^(Abrir|Open) MEMORY\.md$/ }).click();
        await page.waitForTimeout(600);
      },
    },
    {
      name: "agente-contexto",
      route: agentRoute(ids),
      prepare: async (page) => {
        await page.getByRole("tab", { name: /^(Contexto|Context)$/ }).click();
        await page.waitForTimeout(600);
      },
    },
    // #3956: the Plugins page, the Installed tab and then each screen where a person lets code run.
    { name: "plugins", route: { name: "plugins" } },
    {
      name: "plugins-disponiveis",
      route: { name: "plugins" },
      prepare: async (page) => {
        await page.getByRole("tab", { name: /^(Disponíveis|Available)$/ }).click();
        await page.waitForTimeout(400);
      },
    },
    {
      name: "plugins-marketplaces",
      route: { name: "plugins" },
      prepare: async (page) => {
        await page.getByRole("tab", { name: "Marketplaces" }).click();
        await page.waitForTimeout(400);
      },
    },
    {
      name: "plugins-conteudo",
      route: { name: "plugins" },
      prepare: async (page) => {
        await page
          .getByRole("button", {
            name: /^(See what deploy-tools installs|Ver o que instala deploy-tools)$/,
          })
          .click();
        await page.waitForTimeout(600);
      },
    },
    {
      name: "plugins-instalar",
      route: { name: "plugins" },
      prepare: async (page) => {
        await page.getByRole("tab", { name: /^(Disponíveis|Available)$/ }).click();
        await page
          .getByRole("button", { name: /^(Install lint-rules|Instalar lint-rules)$/ })
          .click();
        await page.waitForTimeout(800);
      },
    },
    {
      name: "plugins-atualizar",
      route: { name: "plugins" },
      prepare: async (page) => {
        await page
          .getByRole("button", { name: /^(Update deploy-tools|Atualizar deploy-tools)$/ })
          .click();
        await page.waitForTimeout(800);
      },
    },
    {
      name: "plugins-pasta-recusada",
      route: { name: "plugins" },
      prepare: async (page) => {
        await page
          .getByLabel(/^(Folder of a local plugin|Pasta de um plugin local)/)
          .fill(ids.refusedPluginFolder);
        await page.getByRole("button", { name: /^(Preview the folder|Prévia da pasta)$/ }).click();
        await page.waitForTimeout(1000);
      },
    },
    // Phase 20: the persona library (the pack in the app's language) and the editor's preview.
    { name: "personas", route: { name: "personas" } },
    {
      name: "personas-editor",
      route: { name: "personas" },
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Nova persona|New persona)$/ }).click();
        await page.waitForTimeout(600);
      },
    },
    // The timeline of a session, and its two dialogs.
    {
      name: "linha-do-tempo",
      route: { name: "session", host: ALFA, id: ids.rewindSession },
      prepare: openTimeline,
    },
    {
      name: "linha-do-tempo-voltar",
      route: { name: "session", host: ALFA, id: ids.rewindSession },
      prepare: async (page) => {
        await openTimeline(page);
        await page
          .getByRole("button", { name: /\((turno|turn) 2\)$/ })
          .first()
          .click();
        // The pointer stays where the click was, over the new screen's button: its hover color
        // is not the one the print (and the contrast check) should see.
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(800);
      },
    },
    {
      name: "linha-do-tempo-bifurcar",
      route: { name: "session", host: ALFA, id: ids.rewindSession },
      prepare: async (page) => {
        await openTimeline(page);
        await page
          .getByRole("button", { name: /^(Bifurcar daqui|Fork from here) \(/ })
          .first()
          .click();
        await page.waitForTimeout(600);
      },
    },
    // #4039: the Fork dialog with "Also rewind the files" ticked (turn 2 has files), the same with the
    // preview refused, and the result of a fork opened in the terminal.
    {
      name: "linha-do-tempo-bifurcar-arquivos",
      route: { name: "session", host: ALFA, id: ids.rewindSession },
      prepare: async (page) => {
        await openForkWithFiles(page);
        await page
          .getByText(/^(Calculando o que muda|Working out what changes)/)
          .waitFor({ state: "hidden", timeout: 8000 });
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(400);
      },
    },
    {
      name: "linha-do-tempo-bifurcar-recusa",
      route: { name: "session", host: ALFA, id: ids.rewindSession },
      wire: [
        {
          command: "rewind.preview",
          refuse: "The snapshots could not be read: git is not available here.",
        },
      ],
      prepare: async (page) => {
        await openForkWithFiles(page);
        await page
          .getByRole("button", { name: /^(Tentar de novo|Try again)$/ })
          .waitFor({ timeout: 8000 });
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(400);
      },
    },
    {
      name: "linha-do-tempo-bifurcado",
      route: { name: "session", host: ALFA, id: ids.rewindSession },
      // A real fork writes a transcript on the demo's host: the request goes out as a read, and its
      // answer is the forked session the dialog prints.
      wire: [
        {
          command: "session.fork",
          as: "snapshots.list",
          data: { claudeSessionId: FORKED_SESSION, command: `claude --resume ${FORKED_SESSION}` },
        },
      ],
      prepare: async (page) => {
        await openTimeline(page);
        await page
          .getByRole("button", { name: /^(Bifurcar daqui|Fork from here) \((turno|turn) 2\)$/ })
          .click();
        await page
          .getByRole("radio", { name: /^(Abrir no terminal|Open in the terminal)$/ })
          .check();
        await page.getByRole("button", { name: /^(Bifurcar|Fork)$/ }).click();
        await page
          .getByText(/^(Conversa bifurcada|Conversation forked)/)
          .waitFor({ timeout: 8000 });
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(400);
      },
    },
    // #3982: the Timeline's other states. The refused read, the empty history and the applied rewind
    // are made on the page's sockets (`wire`), so the demo's hosts are never left in them.
    {
      name: "linha-do-tempo-arquivos",
      route: { name: "session", host: ALFA, id: ids.rewindSession },
      prepare: async (page) => {
        await openTimeline(page);
        await page
          .getByRole("button", { name: /^(Ver arquivos do turno|Show files of turn) \d+$/ })
          .first()
          .click();
        await page
          .getByRole("button", { name: /^(Esconder arquivos do turno|Hide files of turn) \d+$/ })
          .first()
          .waitFor({ timeout: 8000 });
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(400);
      },
    },
    {
      // The rewind of turn 2 applied: the notice says so and offers Undo.
      name: "linha-do-tempo-desfeito",
      route: { name: "session", host: ALFA, id: ids.rewindSession },
      wire: [{ command: "rewind.apply", as: "rewind.preview" }],
      prepare: async (page) => {
        await openTimeline(page);
        await page
          .getByRole("button", { name: /\((turno|turn) 2\)$/ })
          .first()
          .click();
        await page
          .getByRole("button", { name: /^(Voltar arquivos|Rewind files)$/ })
          .click({ timeout: 8000 });
        await page
          .getByRole("button", { name: /^(Desfazer volta|Undo rewind)$/ })
          .waitFor({ timeout: 8000 });
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(400);
      },
    },
    {
      // A session in a turn: the notice says why Rewind is off.
      name: "linha-do-tempo-ocupado",
      route: { name: "session", host: ALFA, id: ids.waitingSession },
      prepare: async (page) => {
        await openTimeline(page);
        await page
          .getByText(/^(A sessão está num turno|The session is in a turn)/)
          .waitFor({ timeout: 8000 });
        await page.waitForTimeout(400);
      },
    },
    {
      name: "linha-do-tempo-falhou",
      route: { name: "session", host: ALFA, id: ids.rewindSession },
      wire: [{ command: "snapshots.list", refuse: "The snapshot store could not be read." }],
      prepare: async (page) => {
        await openTimeline(page);
        await page
          .getByRole("button", { name: /^(Tentar de novo|Try again)$/ })
          .waitFor({ timeout: 8000 });
        await page.waitForTimeout(400);
      },
    },
    {
      name: "linha-do-tempo-vazia",
      route: { name: "session", host: ALFA, id: ids.rewindSession },
      wire: [{ command: "snapshots.list", data: { snapshots: [] } }],
      prepare: async (page) => {
        await openTimeline(page);
        await page
          .getByText(/^(Ainda não há turnos|There are no turns)/)
          .waitFor({ timeout: 8000 });
        await page.waitForTimeout(400);
      },
    },
    {
      // Issue #137: the bell's panel, unread rows with their dots, a session's repeats as one row, a read row and a gone target.
      name: "sino-painel",
      inbox: true,
      route: { name: "hub" },
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Notifications|Notificações)/ }).click();
        const panel = page.getByRole("dialog");
        await panel.waitFor({ timeout: 8000 });
        // #1131: the "web · tests" row links to the demo's open Bash request, so it is answerable once the host is in.
        await panel
          .getByRole("button", { name: /^(Approve|Aprovar)/ })
          .first()
          .waitFor({ timeout: 8000 });
        await page.waitForTimeout(400);
      },
    },
    {
      // #3982: the bell's panel with nothing in it.
      name: "sino-vazio",
      route: { name: "hub" },
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Notifications|Notificações)/ }).click();
        await page
          .getByText(/^(No notifications\.|Nenhuma notificação\.)$/)
          .waitFor({ timeout: 8000 });
        await page.waitForTimeout(400);
      },
    },
    {
      // #3982: right after Clear, the panel says so and offers Undo.
      name: "sino-limpo",
      inbox: true,
      route: { name: "hub" },
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Notifications|Notificações)/ }).click();
        const panel = page.getByRole("dialog");
        await panel.waitFor({ timeout: 8000 });
        await panel.getByRole("button", { name: /^(Clear|Limpar)$/ }).click();
        await panel.getByRole("button", { name: /^(Undo|Desfazer)$/ }).waitFor({ timeout: 8000 });
        await page.waitForTimeout(400);
      },
    },
    {
      // Issue #123: Home, the four cards with their seven days.
      name: "inicio-kpis",
      route: { name: "overview" },
      prepare: async (page) => {
        await page.locator(".kpi-card").first().waitFor({ timeout: 8000 });
        await page.waitForTimeout(600);
      },
    },
    // #126: Home with its data scope on one host, from the Data from menu in its toolbar.
    {
      name: "inicio-escopo",
      route: { name: "overview" },
      prepare: async (page) => {
        await page.locator(".kpi-card").first().waitFor({ timeout: 8000 });
        await page.getByRole("button", { name: /^(Dados de|Data from) / }).click();
        await page.getByRole("menuitemradio", { name: "alfa", exact: true }).click();
        await page.getByRole("button", { name: /^(Dados de|Data from) alfa$/ }).waitFor();
        await page.waitForTimeout(600);
      },
    },
    { name: "custos", route: { name: "costs" } },
    // Issue #1345: the Pull requests page, with the open PRs of both hosts.
    {
      name: "pull-requests",
      route: { name: "pull-requests" },
      prepare: async (page) => {
        await page.locator("[data-slot='pr-row']").nth(1).waitFor({ timeout: 8000 });
      },
    },
    // Issue #151: the Activity board, its columns and cards (axe checks it in both themes).
    { name: "atividade", route: { name: "activity" } },
    // Phase 36: the ROI card of the web project, and the project and people tables of Costs.
    {
      name: "roi-cartao",
      roi: true,
      route: { name: "board", host: ALFA, projectId: ids.project },
      prepare: async (page) => {
        const card = page.getByRole("region", { name: /^(Return on cost|Retorno sobre o custo)$/ });
        await card.waitFor({ timeout: 8000 });
        // The card opens folded (issue #178): the print shows it open.
        await card.getByRole("button", { name: /^(Details|Detalhes)$/ }).click();
      },
    },
    {
      name: "roi-custos-pessoas",
      roi: true,
      route: { name: "costs" },
      prepare: async (page) => {
        const table = page.getByRole("table", {
          name: /^(Tokens against delivery, by person|Tokens contra entrega, por pessoa)$/,
        });
        await table.waitFor({ timeout: 8000 });
        await table.scrollIntoViewIfNeeded();
      },
    },
    {
      name: "roi-custos-tabelas",
      roi: true,
      route: { name: "costs" },
      prepare: async (page) => {
        const table = page.getByRole("table", {
          name: /^(Return on cost by project|Retorno sobre o custo por projeto)$/,
        });
        await table.waitFor({ timeout: 8000 });
        await table.scrollIntoViewIfNeeded();
      },
    },
    // The time panel of Custos (phase 23): the wait for permissions and the slowest tools.
    {
      name: "custos-tempo",
      // The time panel is per host: on All hosts, the default scope, it gives way to a pick-a-host line.
      route: { name: "costs", host: ALFA },
      prepare: showSection(/^(Tempo por projeto|Time per project)$/),
    },
    {
      // A session's Tempo tab: each prompt with its tools, the permission wait and the API error.
      name: "sessao-tempo",
      route: { name: "session", host: ALFA, id: ids.idleSession },
      prepare: async (page) => {
        await page.getByRole("tab", { name: /^(Tempo|Time)$/ }).click();
        await page.waitForTimeout(800);
      },
    },
    {
      // A finished terminal session's Rastro tab: the tree with a subagent, bars and highlights.
      name: "rastro",
      route: { name: "external", host: ALFA, claudeSessionId: ids.traceSession },
      prepare: async (page) => {
        await page.getByRole("tab", { name: /^(Rastro|Trace)$/ }).click();
        await page.waitForTimeout(800);
      },
    },
    {
      name: "rastro-replay",
      route: { name: "external", host: ALFA, claudeSessionId: ids.traceSession },
      prepare: async (page) => {
        await page.getByRole("tab", { name: /^(Rastro|Trace)$/ }).click();
        await page.getByRole("button", { name: "Replay" }).click();
        await page.getByRole("button", { name: /^(Próximo|Next)$/ }).click();
        await page.getByRole("button", { name: /^(Próximo|Next)$/ }).click();
        await page.waitForTimeout(500);
      },
    },
    {
      name: "host-telemetria",
      route: { name: "host", host: ALFA },
      prepare: async (page) => {
        await openHostSettings(page);
        await showSection(/^(Telemetria|Telemetry)$/)(page);
      },
    },
    { name: "configuracoes", route: { name: "settings" } },
    // The sections below the first screen of Settings, the host page and the vault: their rows of
    // buttons and fields are checked in the prints too.
    {
      name: "configuracoes-orcamentos",
      route: { name: "settings" },
      prepare: showSection(/^(Budgets of|Orçamentos de) /),
    },
    {
      name: "configuracoes-mensagens",
      route: { name: "settings" },
      prepare: showSection(/^(Messages between sessions on|Mensagens entre sessões em) /),
    },
    {
      // Issue #38: the allowed-folders row, its input and its button on one line.
      name: "host-pastas",
      route: { name: "host", host: ALFA },
      prepare: async (page) => {
        await openHostSettings(page);
        await showSection(/^(Allowed folders|Pastas permitidas)$/)(page);
      },
    },
  ];
}
