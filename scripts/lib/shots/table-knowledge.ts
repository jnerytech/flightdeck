/** Part of the print table (scripts/demo-shots.ts), in print order: the Knowledge panel and the Memory tab (#4236). */
import type { KnowledgeEntry } from "@flightdeck/protocol";
import type { Locator, Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { ALFA, agentRoute, type Shot } from "./shot.ts";

/** A document's path in the library; built, so the guard that checks the docs the code names does not look for a real file. */
const doc = (kind: string, file: string) => `docs/${kind}/${file}`;

/** A line of the library as the host lists it: a state the demo's folders are never left in. */
const entry = (
  path: string,
  title: string,
  over: Partial<KnowledgeEntry> = {},
): KnowledgeEntry => ({
  path,
  title,
  type: "adr",
  status: "valid",
  supersedes: null,
  bytes: 240,
  changedAt: "2026-11-01T10:00:00.000Z",
  problems: [],
  warnings: [],
  hash: path,
  ...over,
});

const TOKENS = "Design tokens come from one file";
const OLD_GRID = "A fixed twelve column grid";

/** The panel's list with one document that points at an obsolete one and one whose front matter is wrong. */
const WARNED: KnowledgeEntry[] = [
  entry(doc("adr", "0001-design-tokens.md"), TOKENS, {
    warnings: [`references_obsolete:${doc("adr", "0003-fixed-grid.md")}`],
  }),
  entry(doc("rfc", "0002-dark-mode.md"), "Dark mode for every screen", {
    type: "rfc",
    status: "unclassified",
    problems: ["status_unknown", "supersedes_missing"],
  }),
  entry(doc("adr", "0003-fixed-grid.md"), OLD_GRID, { status: "obsolete" }),
];

/** More documents than the list holds: the panel says its counts are of the loaded ones. */
const CUT: KnowledgeEntry[] = [
  entry(doc("adr", "0001-design-tokens.md"), TOKENS),
  entry(doc("rfc", "0002-dark-mode.md"), "Dark mode for every screen", {
    type: "rfc",
    status: "transitional",
  }),
  entry(doc("adr", "0003-fixed-grid.md"), OLD_GRID, { status: "obsolete" }),
];

/** The panel of the design-system project, with its documents loaded or its other state on screen. */
const panelOf = (page: Page): Locator =>
  page.getByRole("region", { name: /^(Project knowledge|Conhecimento do projeto)$/ });

async function panelReady(page: Page): Promise<Locator> {
  const panel = panelOf(page);
  await panel.waitFor({ timeout: 15_000 });
  return panel;
}

/** The seeded library is listed: the print waits for its first document. */
async function listed(page: Page): Promise<Locator> {
  const panel = await panelReady(page);
  await panel.getByText(TOKENS).first().waitFor({ timeout: 15_000 });
  await panel.scrollIntoViewIfNeeded();
  return panel;
}

const words = (page: Page, text: RegExp) => page.getByText(text);

export function knowledgeShots(ids: DemoIds): Shot[] {
  const route = { name: "project" as const, host: ALFA, projectId: ids.knowledgeProject };
  const answer = (entries: KnowledgeEntry[], truncated = false) => ({
    command: "knowledge.list",
    data: { entries, truncated },
  });
  return [
    {
      // A project with no document in its folders: the text and no filters.
      name: "projeto-conhecimento-vazio",
      route,
      wire: [answer([])],
      prepare: async (page) => {
        const panel = await panelReady(page);
        await panel
          .getByText(/^(No documents in docs\/|Nenhum documento em docs\/)/)
          .waitFor({ timeout: 15_000 });
        await panel.scrollIntoViewIfNeeded();
      },
    },
    {
      // The host did not answer the list: the message, its hint and Try again.
      name: "projeto-conhecimento-falhou",
      route,
      wire: [
        { command: "knowledge.list", refuse: "The documents could not be read from this host." },
      ],
      prepare: async (page) => {
        const panel = await panelReady(page);
        await panel
          .getByRole("button", { name: /^(Try again|Tentar de novo)$/ })
          .waitFor({ timeout: 15_000 });
        await panel.scrollIntoViewIfNeeded();
      },
    },
    {
      // The host never answers the list, so the panel stays loading.
      name: "projeto-conhecimento-carregando",
      route,
      wire: [{ command: "knowledge.list", hold: true }],
      prepare: async (page) => {
        const panel = await panelReady(page);
        await panel
          .getByRole("status", { name: /^(Loading documents|Carregando os documentos)$/ })
          .waitFor({ timeout: 15_000 });
        // The placeholders are drawn 200 ms after the label: the print waits for the first one.
        await panel.locator('[role="status"][aria-busy="true"] > *').first().waitFor();
        await panel.scrollIntoViewIfNeeded();
      },
    },
    {
      // New document with a title and a host that refuses it: the reason, and the title is kept.
      name: "projeto-conhecimento-criar-erro",
      route,
      wire: [
        {
          command: "knowledge.create",
          deny: "A document with this title already exists in docs/adr.",
        },
      ],
      prepare: async (page) => {
        const panel = await listed(page);
        await panel.getByLabel(/^(Title|Título)$/).fill(TOKENS);
        await panel
          .getByRole("button", { name: /^(Create from template|Criar a partir do modelo)$/ })
          .click();
        await panel
          .getByRole("alert")
          .filter({ hasText: "already exists in docs/adr" })
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      // A filter that no document has: the line that says so, and the counts above it.
      name: "projeto-conhecimento-sem-status",
      route,
      prepare: async (page) => {
        const panel = await listed(page);
        await panel
          .getByRole("button", { name: /^(Not classified|Sem classificação) \(0\)$/ })
          .click();
        await words(
          page,
          /^(No documents with this status\.|Nenhum documento com este status\.)$/,
        ).waitFor();
      },
    },
    {
      // The index switch is off for this project: the words and Turn on.
      name: "projeto-conhecimento-indice-desligado",
      route,
      wire: [
        {
          command: "knowledge.feed",
          data: { on: false, trusted: true, offBy: "/srv/design-system", own: true },
        },
      ],
      prepare: async (page) => {
        const panel = await listed(page);
        await panel.getByRole("button", { name: /^(Turn on|Ligar)$/ }).waitFor();
      },
    },
    {
      // The switch could not be read: the alert and Try again.
      name: "projeto-conhecimento-indice-falhou",
      route,
      wire: [
        { command: "knowledge.feed", refuse: "The index switch could not be read on this host." },
      ],
      prepare: async (page) => {
        const panel = await listed(page);
        await panel
          .getByRole("button", { name: /^(Try again|Tentar de novo)$/ })
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      // The list is cut: the panel says the counts are of the documents loaded.
      name: "projeto-conhecimento-cortada",
      route,
      wire: [answer(CUT, true)],
      prepare: async (page) => {
        const panel = await listed(page);
        await panel
          .getByText(
            /^(The counts are of the documents loaded|As contagens são dos documentos carregados)/,
          )
          .waitFor();
      },
    },
    {
      // A document with a warning and one with problems in its front matter, each with its icon.
      name: "projeto-conhecimento-avisos",
      route,
      wire: [answer(WARNED)],
      prepare: async (page) => {
        const panel = await listed(page);
        await panel
          .getByText(/^(Points at an obsolete document|Aponta para um documento obsoleto)/)
          .waitFor();
      },
    },
    {
      // Change with the host not yet answering: the button is busy and the picker stays.
      name: "projeto-conhecimento-ocupado",
      route,
      wire: [{ command: "knowledge.setStatus", pending: true }],
      prepare: async (page) => {
        const panel = await listed(page);
        await panel
          .getByRole("combobox", { name: new RegExp(`^(Status of|Status de) ${TOKENS}$`) })
          .selectOption("obsolete");
        const change = panel.getByRole("button", {
          name: new RegExp(`^(Change the status of|Alterar o status de) ${TOKENS}$`),
        });
        await change.click();
        await panel.locator('button[aria-busy="true"]').waitFor();
      },
    },
  ];
}

/** The Memory tab of the demo's project, open and waiting for the first file the demo seeds. */
async function memoryTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: /^(Memória|Memory)$/ }).click();
}

async function memoryListed(page: Page): Promise<void> {
  await memoryTab(page);
  await page
    .getByRole("button", { name: /^(Abrir|Open) MEMORY\.md$/ })
    .waitFor({ timeout: 15_000 });
}

const openFile = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^(Abrir|Open) ${name.replace(".", "\\.")}$`) });

/** A file opened and one more line typed into it: the text now differs from the saved one. */
async function edited(page: Page): Promise<void> {
  await memoryListed(page);
  await openFile(page, "user_role.md").click();
  const editor = page.getByLabel(/^(Conteúdo de|Content of) user_role\.md$/);
  await editor.waitFor();
  await editor.fill(`${await editor.inputValue()}\nMais uma linha.\n`);
  await page.getByText(/^(Alterações não salvas|Unsaved changes)$/).waitFor();
}

const button = (page: Page, name: RegExp) => page.getByRole("button", { name });

export function memoryShots(ids: DemoIds): Shot[] {
  const route = agentRoute(ids);
  return [
    {
      // A project with no memory: the text, and the way to the first file.
      name: "agente-memoria-vazio",
      route,
      wire: [{ command: "memory.list", data: { dir: "memory", exists: false, files: [] } }],
      prepare: async (page) => {
        await memoryTab(page);
        await page
          .getByText(
            /^(There is no memory in this project yet\.|Ainda não há memória neste projeto\.)$/,
          )
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      // The list did not load: the message and Try again, not the empty text.
      name: "agente-memoria-falhou",
      route,
      wire: [{ command: "memory.list", refuse: "The memory could not be read." }],
      prepare: async (page) => {
        await memoryTab(page);
        await page
          .getByText(
            /^(Could not read this project's memory\.|Não foi possível ler a memória deste projeto\.)$/,
          )
          .waitFor({ timeout: 15_000 });
        await button(page, /^(Try again|Tentar de novo)$/).waitFor();
      },
    },
    {
      // The host never answers the list, so the tab stays loading.
      name: "agente-memoria-carregando",
      route,
      wire: [{ command: "memory.list", hold: true }],
      prepare: async (page) => {
        await memoryTab(page);
        await page
          .getByRole("status", {
            name: /^(Loading the configuration…|Carregando a configuração…)$/,
          })
          .waitFor({ timeout: 15_000 });
        // The placeholders are drawn 200 ms after the label: the print waits for the first one.
        await page.locator('[role="status"][aria-busy="true"] > *').first().waitFor();
      },
    },
    {
      // A name with a character the folder does not take: the rule says what is wrong.
      name: "agente-memoria-nome-erro",
      route,
      prepare: async (page) => {
        await memoryListed(page);
        await button(page, /^(Nova memória|New memory)$/).click();
        await page.getByLabel(/^(Nome do arquivo|File name)$/).fill("notes/draft");
        await page.getByText(/^(Use só letras|Use only letters)/).waitFor();
      },
    },
    {
      // A new file with text typed and not saved: "New file" and "Unsaved changes".
      name: "agente-memoria-novo",
      route,
      prepare: async (page) => {
        await memoryListed(page);
        await button(page, /^(Nova memória|New memory)$/).click();
        await page.getByLabel(/^(Nome do arquivo|File name)$/).fill("draft");
        await button(page, /^(Criar|Create)$/).click();
        const editor = page.getByLabel(/^(Conteúdo de|Content of) draft\.md$/);
        await editor.waitFor();
        await editor.fill("Uma nota nova.\n");
        await page.getByText(/^(Alterações não salvas|Unsaved changes)$/).waitFor();
      },
    },
    { name: "agente-memoria-editado", route, prepare: edited },
    {
      // Save refused because the file changed on disk: what was typed stays, with the notice and Reload.
      name: "agente-memoria-desatualizado",
      route,
      wire: [
        { command: "memory.write", deny: "The file changed on disk." },
        {
          command: "memory.read",
          data: {
            name: "user_role.md",
            hash: "opened",
            bytes: 90,
            lines: 6,
            inIndex: true,
            content: "---\nname: perfil\ntype: user\n---\n\nA equipe de plataforma mantém o app.\n",
          },
          after: {
            name: "user_role.md",
            hash: "changed",
            bytes: 120,
            lines: 7,
            inIndex: true,
            content: "---\nname: perfil\ntype: user\n---\n\nA equipe mudou no disco.\n",
          },
        },
      ],
      prepare: async (page) => {
        await edited(page);
        await button(page, /^(Salvar|Save)$/).click();
        await button(page, /^(Salvar na memória|Save to memory)$/).click();
        await page
          .getByText(/^(O arquivo mudou no disco|The file changed on disk)/)
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      // Save asks first, and names the file it will write.
      name: "agente-memoria-salvar",
      route,
      prepare: async (page) => {
        await edited(page);
        await button(page, /^(Salvar|Save)$/).click();
        await page.getByRole("alertdialog").waitFor();
      },
    },
    {
      // Delete asks first, and says it cannot be undone.
      name: "agente-memoria-excluir",
      route,
      prepare: async (page) => {
        await memoryListed(page);
        await button(page, /^(Apagar|Delete) solta\.md$/).click();
        await page.getByRole("alertdialog").waitFor();
      },
    },
    {
      // Opening another file with edits not saved asks before they are lost.
      name: "agente-memoria-descartar",
      route,
      prepare: async (page) => {
        await edited(page);
        await openFile(page, "feedback_testes.md").click();
        await page.getByRole("alertdialog").waitFor();
      },
    },
  ];
}
