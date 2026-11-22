/**
 * Part of the print table (scripts/demo-shots.ts), in print order: the project's Claude Code setup
 * (its checklist, the setup preview and the share dialog) and the host's setup templates (#4110).
 * What the demo's hosts cannot be left in (a preview to apply, templates that are shared) is answered
 * on the page's sockets (`wire`); no print applies, commits, shares or deletes anything.
 */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { ALFA, openHostSettings, type Shot, showSection } from "./shot.ts";
import type { WireRule } from "./wire.ts";

const text = (en: string, pt: string) => new RegExp(`^(${en}|${pt})$`);

const PANEL = text("Claude Code setup", "Configuração do Claude Code");
const SETUP = text("Set up Claude Code", "Configurar o Claude Code");
const SHARE = text("Share as template", "Compartilhar como modelo");
const NAME = text("Template name", "Nome do modelo");
const TEMPLATES = text("Claude Code setup templates", "Modelos de configuração do Claude Code");
const DELETE_FIRST = /^(Delete template|Apagar o modelo) /;

const TEMPLATE_LIST = [
  {
    id: "web-service",
    title: "Web service",
    files: ["CLAUDE.md", "agents/reviewer.md", "skills/release/SKILL.md"],
    bytes: 6144,
  },
  { id: "cli-tool", title: "CLI tool", files: ["CLAUDE.md"], bytes: 1536 },
];

/** What a setup with a formatter hook, two deny rules and two new files would add to the project. */
const PREVIEW = {
  settings: {
    path: ".claude/settings.json",
    hash: null,
    hooks: [
      { event: "PostToolUse", matcher: "Edit|Write", command: "bun run format" },
      { event: "PreToolUse", matcher: "Bash", command: "bun run guard:git-add" },
    ],
    denyRules: ["Read(./.env)", "Bash(git add -A:*)"],
    conflicts: [],
    reformats: false,
    digest: "demo-settings",
  },
  files: [
    {
      path: "CLAUDE.md",
      content: "# Web\n\n## Commands\n\n- Test: `bun test`\n- Lint: `bun run lint`\n",
      digest: "demo-claude-md",
    },
    {
      path: ".claude/agents/reviewer.md",
      content:
        "---\nname: reviewer\ndescription: Reviews a change before it is opened as a pull request.\n---\n\nRead the diff and report what could break.\n",
      digest: "demo-reviewer",
    },
  ],
  unreadable: [],
};

const templates = (list: typeof TEMPLATE_LIST): WireRule => ({
  command: "harness.templates.list",
  data: { templates: list },
});

/** The project page, with its Claude Code setup panel in view. */
async function showPanel(page: Page): Promise<void> {
  await showSection(PANEL)(page);
  await page.getByRole("button", { name: SETUP }).waitFor({ timeout: 15_000 });
}

/** The host's Settings, with its templates in view. */
async function showTemplates(page: Page): Promise<void> {
  await openHostSettings(page);
  await showSection(TEMPLATES)(page);
}

/** The pointer away from the buttons, and a beat for the focus ring and the animation to settle. */
async function park(page: Page): Promise<void> {
  await page.mouse.move(1000, 700);
  await page.waitForTimeout(400);
}

/** What a print waits for before the shot: the dialog in place. */
async function settled(page: Page): Promise<void> {
  await page.getByRole("alertdialog").waitFor({ timeout: 8000 });
  await park(page);
}

export function harnessShots(ids: DemoIds): Shot[] {
  const project = { name: "project" as const, host: ALFA, projectId: ids.project };
  const host = { name: "host" as const, host: ALFA };
  return [
    {
      name: "projeto-harness",
      route: project,
      prepare: async (page) => {
        await showPanel(page);
      },
    },
    {
      name: "projeto-harness-preview",
      route: project,
      // The preview is made up: the host's own would depend on the demo project's files.
      wire: [{ command: "project.harness.preview", data: PREVIEW }, templates(TEMPLATE_LIST)],
      prepare: async (page) => {
        await showPanel(page);
        await page.getByRole("button", { name: SETUP }).click();
        await settled(page);
      },
    },
    {
      name: "projeto-harness-preview-recusa",
      route: project,
      // The templates are answered too: the dialog's "Start from" reads the host's, which the demo does not fix.
      wire: [
        {
          command: "project.harness.preview",
          refuse: "The setup could not be read: git is not available here.",
        },
        templates(TEMPLATE_LIST),
      ],
      prepare: async (page) => {
        await showPanel(page);
        await page.getByRole("button", { name: SETUP }).click();
        // The refusal's text is the title plus the host's message, in either language.
        await page
          .getByRole("alert")
          .filter({ hasText: /git is not available here/ })
          .waitFor({ timeout: 8000 });
        await park(page);
      },
    },
    {
      name: "projeto-harness-compartilhar",
      route: project,
      prepare: async (page) => {
        await showPanel(page);
        await page.getByRole("button", { name: SHARE }).click();
        await page.getByLabel(NAME).fill("Web service");
        await settled(page);
      },
    },
    {
      name: "host-modelos-harness",
      route: host,
      wire: [templates(TEMPLATE_LIST)],
      prepare: async (page) => {
        await showTemplates(page);
        await page.getByRole("button", { name: DELETE_FIRST }).first().waitFor({ timeout: 8000 });
      },
    },
    {
      name: "host-modelos-harness-vazio",
      route: host,
      wire: [templates([])],
      prepare: async (page) => {
        await showTemplates(page);
        await page.getByText(/^(No templates yet|Nenhum modelo ainda)/).waitFor({ timeout: 8000 });
      },
    },
    {
      name: "host-modelos-harness-apagar",
      route: host,
      wire: [templates(TEMPLATE_LIST)],
      prepare: async (page) => {
        await showTemplates(page);
        await page.getByRole("button", { name: DELETE_FIRST }).first().click();
        await settled(page);
      },
    },
  ];
}
