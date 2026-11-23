/** Part of the print table (scripts/demo-shots.ts), in print order: the Files and Context tabs of the Agent screen (#4269). */
import type { ContextBudget } from "@flightdeck/protocol";
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { agentRoute, type Shot, toastSettled } from "./shot.ts";
import type { WireRule } from "./wire.ts";

const tab = (page: Page, name: RegExp | string) => page.getByRole("tab", { name }).click();
const button = (page: Page, name: RegExp) => page.getByRole("button", { name });
const AGENTS = /^(Agentes|Agents)$/;
const REVISOR = /^revisor \(/;

/** An agent file as the host holds it, and the same file after someone else changed it on disk. */
const AGENT_FILE = (description: string) =>
  `---\nname: revisor\ndescription: ${description}\ntools: Read, Grep\nmodel: sonnet\n---\nReview the diff before the commit.\n`;

/** The Agents tab, with the demo's reviewer open. */
async function openReviewer(page: Page): Promise<void> {
  await tab(page, AGENTS);
  await button(page, REVISOR).click();
  await page.getByLabel(/^(Description|Descrição)$/).waitFor({ timeout: 15_000 });
}

/** The reviewer's description is changed, so the file differs from the saved one. */
async function editReviewer(page: Page): Promise<void> {
  await openReviewer(page);
  await page.getByLabel(/^(Description|Descrição)$/).fill("Reviews the diff and the tests");
}

/** A write the print opens the editor for is answered with a refusal in the page: nothing reaches the host. */
const NO_WRITE: WireRule = { command: "agentcfg.write", reject: "A print does not write." };

export function filesShots(ids: DemoIds): Shot[] {
  const route = agentRoute(ids);
  return [
    {
      name: "agente-claude-md-vazio",
      route,
      wire: [{ command: "agentcfg.list", data: { items: [] } }],
      prepare: async (page) => {
        await tab(page, "CLAUDE.md");
        await page
          .getByText(/^(No CLAUDE\.md in this project\.|Nenhum CLAUDE\.md neste projeto\.)$/)
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "agente-agentes-falhou",
      route,
      wire: [{ command: "agentcfg.list", refuse: "The agents could not be read." }],
      prepare: async (page) => {
        await tab(page, AGENTS);
        await button(page, /^(Try again|Tentar de novo)$/).waitFor({ timeout: 15_000 });
        await toastSettled(page);
      },
    },
    {
      name: "agente-skills-nome-invalido",
      route,
      wire: [NO_WRITE],
      prepare: async (page) => {
        await tab(page, "Skills");
        await button(page, /^(New skill|Nova skill)$/).click();
        await page.getByLabel(/^(Skill name|Nome da skill)$/).fill("../not a name");
        await page
          .getByText(/^(That name is not allowed\.|Esse nome não é permitido\.)$/)
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "agente-agentes-descartar",
      route,
      wire: [NO_WRITE],
      prepare: async (page) => {
        await editReviewer(page);
        await button(page, REVISOR).click();
        await page.getByRole("alertdialog").waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "agente-agentes-obsoleto",
      route,
      wire: [
        {
          command: "agentcfg.read",
          data: { content: AGENT_FILE("Reviews the diff before the commit"), hash: "hash-a" },
          after: { content: AGENT_FILE("Reviews the diff, changed on disk"), hash: "hash-b" },
        },
        NO_WRITE,
      ],
      prepare: async (page) => {
        await editReviewer(page);
        await button(page, /^(Save|Salvar)$/).click();
        await page
          .getByText(/^(The file changed on disk|O arquivo mudou no disco)/)
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "agente-agentes-salvo",
      route,
      wire: [{ command: "agentcfg.write", reply: { hash: "hash-saved" } }],
      prepare: async (page) => {
        await editReviewer(page);
        await button(page, /^(Save|Salvar)$/).click();
        await page.getByText(/^(Saved\.|Salvo\.)$/).waitFor({ timeout: 15_000 });
      },
    },
  ];
}

/** A source the context loads: the project's own file, a user's rule and the memory's index. */
const SOURCES: ContextBudget["sources"] = [
  {
    kind: "project",
    path: "/home/demo/flightdeck-web/CLAUDE.md",
    bytes: 4200,
    tokens: 1050,
    load: "start",
  },
  {
    kind: "rules",
    path: "/home/demo/flightdeck-web/.claude/rules/ui.md",
    bytes: 2800,
    tokens: 700,
    load: "on-demand",
  },
  {
    kind: "memory",
    path: "/home/demo/.claude/projects/web/memory/MEMORY.md",
    bytes: 20_900,
    tokens: 5225,
    load: "start",
  },
];

/** The budget the host answers with: `memory` is what changes from one print to the next. */
const budget = (
  sources: ContextBudget["sources"],
  memory: Partial<ContextBudget["memory"]>,
): WireRule => ({
  command: "memory.budget",
  data: {
    root: "/home/demo/flightdeck-web/",
    home: "/home/demo/",
    sources,
    startTokens: sources.filter((s) => s.load === "start").reduce((sum, s) => sum + s.tokens, 0),
    memory: {
      limitLines: 200,
      limitBytes: 25_600,
      indexLines: 0,
      indexBytes: 0,
      loadedLines: 0,
      loadedBytes: 0,
      cutBy: null,
      leftOutLines: [],
      leftOutFiles: [],
      ...memory,
    },
  } satisfies ContextBudget,
});

const contextTab = (page: Page) => tab(page, /^(Contexto|Context)$/);

export function contextShots(ids: DemoIds): Shot[] {
  const route = agentRoute(ids);
  return [
    {
      name: "agente-contexto-vazio",
      route,
      wire: [budget([], {})],
      prepare: async (page) => {
        await contextTab(page);
        await page
          .getByText(
            /^(Nothing enters the context at the start of this project\.|Nada entra no contexto na partida deste projeto\.)$/,
          )
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "agente-contexto-cortado",
      route,
      wire: [
        budget(SOURCES, {
          indexLines: 230,
          indexBytes: 24_000,
          loadedLines: 200,
          loadedBytes: 20_900,
          cutBy: "lines",
          leftOutLines: [
            "- [Release flow](release-flow.md) — rc draft PR first, tag in its own push",
            "- [Notify on release](notify-on-release.md) — push-notify every published release with its highlights",
          ],
          leftOutFiles: ["release-flow.md", "notify-on-release.md"],
        }),
      ],
      prepare: async (page) => {
        await contextTab(page);
        await page
          .getByText(/^(Only the first 200 lines|Só as primeiras 200 linhas)/)
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "agente-contexto-falhou",
      route,
      wire: [{ command: "memory.budget", refuse: "The budget could not be read." }],
      prepare: async (page) => {
        await contextTab(page);
        await button(page, /^(Try again|Tentar de novo)$/).waitFor({ timeout: 15_000 });
        await toastSettled(page);
      },
    },
  ];
}
