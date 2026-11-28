/** Part of the print table (scripts/demo-shots.ts), in print order: the Personas screen's states (#4215). */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import type { Shot } from "./shot.ts";
import type { WireRule } from "./wire.ts";

const WAIT = 15_000;
/** A button by its name in either language: the prints run in both. */
const button = (page: Page, pattern: string) =>
  page.getByRole("button", { name: new RegExp(`^(${pattern})$`) });
const text = (page: Page, pattern: string) => page.getByText(new RegExp(pattern));
const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const PROJECT_PATH = "/home/demo/flightdeck-web";
const HASH = "3f9a1c0de27b64a85d0c4be1f2a7c9d83b60e5f1a49c7d2e8b13f06a5c4d9e72";

/** One persona as `personas.list` answers it. */
function persona(
  id: string,
  name: string,
  description: string,
  scope: "pack" | "host" | "project",
  state: { trusted?: boolean; modified?: boolean } = {},
) {
  return {
    id,
    name,
    description,
    icon: null,
    model: "sonnet",
    effort: null,
    tools: ["Read", "Grep"],
    permissionMode: null,
    body: `You are ${name}. Answer in short, concrete steps.`,
    scope,
    hash: scope === "project" ? HASH : null,
    trusted: state.trusted ?? true,
    modified: state.modified ?? false,
  };
}

const REVIEWER = persona(
  "reviewer",
  "Reviewer",
  "Reads a diff and lists what could break.",
  "pack",
);
const TESTER = persona("tester", "Tester", "Writes the failing test first.", "pack", {
  modified: true,
});
const NOTES = persona(
  "release-notes",
  "Release notes",
  "Turns merged pull requests into notes.",
  "project",
);
const MIGRATOR = persona(
  "db-migrator",
  "DB migrator",
  "Plans a schema change in small, reversible steps.",
  "project",
  { trusted: false },
);

const list = (personas: unknown[], project: { path: string; errors: string[] } | null = null) =>
  ({ command: "personas.list", data: { personas, project } }) satisfies WireRule;
const projectInfo = { path: `${PROJECT_PATH}/.flightdeck/personas`, errors: [] };

/** The Edit button of a persona, and the wait for the editor it opens. */
async function openEditor(page: Page, name: string): Promise<void> {
  await button(page, `Edit ${literal(name)}|Editar ${literal(name)}`).click({
    timeout: WAIT,
  });
  await page.getByLabel(/^(Name|Nome)/).waitFor({ timeout: WAIT });
}

/** Picks the demo's project in the Project select, so the list is the project's. */
async function pickProject(page: Page, ids: DemoIds): Promise<void> {
  await page.getByLabel(/^(Project|Projeto)/).selectOption({ label: ids.projectName });
}

/** Waits for the persona rows to show, and moves the pointer off every button. */
async function settled(page: Page, name: string): Promise<void> {
  await text(page, literal(name)).first().waitFor({ timeout: WAIT });
  await page.mouse.move(1000, 700);
  await page.waitForTimeout(400);
}

export function personaShots(ids: DemoIds): Shot[] {
  const route = { name: "personas" } as const;
  const host = list([
    REVIEWER,
    TESTER,
    persona("pair", "Pair writer", "Drafts text with you.", "host"),
  ]);
  const project = list([REVIEWER, NOTES, MIGRATOR], projectInfo);
  return [
    {
      // Edit on a row: the form opens with the persona's own values, and its id cannot change.
      name: "personas-editor-existing",
      route,
      wire: [host],
      prepare: async (page) => {
        await openEditor(page, "Reviewer");
        await page.waitForTimeout(400);
      },
    },
    {
      // A new persona with a bad id and icon: both fields say their rule, and Save says what is missing.
      name: "personas-editor-errors",
      route,
      prepare: async (page) => {
        await button(page, "New persona|Nova persona").click({ timeout: WAIT });
        await page.getByLabel(/^(Id)/).fill("Bad Id");
        await page.getByLabel(/^(Icon|Ícone)/).fill("Bad_Icon");
        await page.keyboard.press("Tab");
        await text(page, "To save, fill in or fix|Para salvar, preencha ou corrija").waitFor({
          timeout: WAIT,
        });
      },
    },
    {
      // A project's versioned persona is not trusted until its hash is: Trust is on its row.
      name: "personas-untrusted",
      route,
      wire: [project],
      prepare: async (page) => {
        await pickProject(page, ids);
        await button(page, "Trust DB migrator|Confiar em DB migrator").waitFor({
          timeout: WAIT,
        });
        await settled(page, "DB migrator");
      },
    },
    {
      // A pack persona the host edited: Restore original is on its row, and Remove is not.
      name: "personas-modified",
      route,
      wire: [host],
      prepare: async (page) => {
        await button(page, "Restore the original of Tester|Restaurar original de Tester").waitFor({
          timeout: WAIT,
        });
        await settled(page, "Tester");
      },
    },
    {
      // A project chosen: every row can be published as the project's own agent.
      name: "personas-project",
      route,
      wire: [
        list(
          [NOTES, persona("api-docs", "API docs", "Keeps the API reference current.", "project")],
          projectInfo,
        ),
      ],
      prepare: async (page) => {
        await pickProject(page, ids);
        await button(
          page,
          "Publish Release notes as a project agent|Publicar Release notes como agente do projeto",
        ).waitFor({ timeout: WAIT });
        await settled(page, "API docs");
      },
    },
    {
      name: "personas-remove",
      route,
      wire: [list([REVIEWER, persona("pair", "Pair writer", "Drafts text with you.", "host")])],
      prepare: async (page) => {
        await button(page, "Remove Pair writer|Remover Pair writer").click({
          timeout: WAIT,
        });
        await text(page, "Remove the persona Pair writer|Remover a persona Pair writer").waitFor({
          timeout: WAIT,
        });
      },
    },
    {
      name: "personas-reset",
      route,
      wire: [host],
      prepare: async (page) => {
        await button(page, "Restore the original of Tester|Restaurar original de Tester").click({
          timeout: WAIT,
        });
        await text(page, "Restore Tester to the original|Restaurar Tester ao original").waitFor({
          timeout: WAIT,
        });
      },
    },
    {
      name: "personas-publish",
      route,
      wire: [project],
      prepare: async (page) => {
        await pickProject(page, ids);
        await button(
          page,
          "Publish Release notes as a project agent|Publicar Release notes como agente do projeto",
        ).click({ timeout: WAIT });
        await text(page, "persona-release-notes.md").waitFor({ timeout: WAIT });
      },
    },
    {
      // Trust on a file the host does not have: the host's own refusal is said on the page, with the persona's name.
      name: "personas-refused",
      route,
      wire: [project],
      prepare: async (page) => {
        await pickProject(page, ids);
        await button(page, "Trust DB migrator|Confiar em DB migrator").click({
          timeout: WAIT,
        });
        await text(
          page,
          "Could not do that for DB migrator|Não foi possível fazer isso com DB migrator",
        ).waitFor({
          timeout: WAIT,
        });
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(400);
      },
    },
    {
      // A publish the host accepted: the page says where the agent went. The host writes nothing: the answer is made in the page.
      name: "personas-published",
      route,
      wire: [
        project,
        {
          command: "personas.publishAgent",
          reply: { path: ".claude/agents/persona-release-notes.md" },
        },
      ],
      prepare: async (page) => {
        await pickProject(page, ids);
        await button(
          page,
          "Publish Release notes as a project agent|Publicar Release notes como agente do projeto",
        ).click({ timeout: WAIT });
        await button(page, "Publish|Publicar").click({ timeout: WAIT });
        await text(page, "Published Release notes at|Release notes publicada em").waitFor({
          timeout: WAIT,
        });
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(400);
      },
    },
    {
      name: "personas-failed",
      route,
      wire: [{ command: "personas.list", refuse: "The host's personas could not be read." }],
      prepare: async (page) => {
        await button(page, "Try again|Tentar de novo").waitFor({ timeout: WAIT });
      },
    },
    {
      name: "personas-empty",
      route,
      wire: [list([])],
      prepare: async (page) => {
        await text(page, String.raw`No persona\.|Nenhuma persona\.`).waitFor({ timeout: WAIT });
      },
    },
    {
      // No connected host offers personas: the page says so, and Add a host leads on.
      name: "personas-no-host",
      route,
      wire: [{ command: "host.info", without: { features: ["personas"] } }],
      prepare: async (page) => {
        await page.waitForTimeout(1500);
      },
    },
  ];
}
